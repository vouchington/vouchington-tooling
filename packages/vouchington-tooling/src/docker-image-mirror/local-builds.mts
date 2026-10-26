import { withoutShellComment } from '../trivy-policy/shell.mts'
import { normalizeText, stepEnv } from './shell-vars.mts'

// Images a workflow file or composite action builds locally are never pulled, so a registry
// allowlist or digest pin cannot apply to them. A tag is recorded as normalized text, so `$VAR`,
// `${VAR}` and `${{ env.VAR }}` spellings compare equal; a tag that is only a variable is skipped.
// `docker/metadata-action` `images:` names count as built repositories (any tag) when a build step
// in the same file consumes that step's outputs.
export type BuildStep = {
  id?: string
  env?: unknown
  run?: string
  uses?: string
  with?: Record<string, unknown>
}

export interface LocalBuilds {
  readonly tags: ReadonlySet<string>
  readonly stepIds: ReadonlySet<string>
  readonly repositories: ReadonlySet<string>
}

const STEP_OUTPUT = /^\$\{\{\s*steps\.([\w-]+)\.outputs\.[\w-]+\s*\}\}$/u
// A build counts only at a command position, not as text inside `echo` or another argument.
const BUILD_COMMAND =
  /(?:^|[;&|(]|\b(?:sudo|then|do|else))[ \t]*(?:docker\s+(?:buildx\s+)?|podman\s+)build\b([^\n;&|]*)/gmu

function recorded(tag: string, step: BuildStep): string | undefined {
  const value = normalizeText(tag.trim(), stepEnv(step))
  return value === '' || /^\$\w+$|^\$\{\{.*\}\}$/u.test(value) ? undefined : value
}

/** Repository part of an image reference: everything before a trailing `:tag`. */
function repositoryOf(image: string): string {
  const colon = image.lastIndexOf(':')
  return colon > image.lastIndexOf('/') ? image.slice(0, colon) : image
}

function isLoaded(value: unknown): boolean {
  return value === true || value === 'true'
}

function isNotLoaded(value: unknown): boolean {
  return value === false || value === 'false'
}

/** Bake output overrides that keep the image out of the local store (cache-only, registry, ...). */
const FOREIGN_OUTPUT = /output=(?!(?:type=)?docker\b)/u

/** A `docker/build-push-action` with `load: true`, or a `docker/bake-action` that does not push. */
function isBuildAction(step: BuildStep): boolean {
  if (step.uses?.startsWith('docker/bake-action@')) {
    const set = step.with?.set
    const foreign = typeof set === 'string' && FOREIGN_OUTPUT.test(set)
    return !isLoaded(step.with?.push) && !isNotLoaded(step.with?.load) && !foreign
  }
  return step.uses?.startsWith('docker/build-push-action@') === true && isLoaded(step.with?.load)
}

/** Raw tag values of every build command in a script, or undefined when it builds nothing. */
function runBuildTags(script: string): string[] | undefined {
  const logical = withoutShellComment(script).replace(/\\\r?\n/gu, ' ')
  const commands = [...logical.matchAll(BUILD_COMMAND)]
  if (commands.length === 0) return undefined
  const tags: string[] = []
  for (const [, args] of commands) {
    const tokens = args!.match(/(?:\$\{\{.*?\}\}|[^\s"']|"[^"]*"|'[^']*')+/gu) ?? []
    tokens.forEach((token, i) => {
      if (token === '-t' || token === '--tag') tags.push(tokens[i + 1] ?? '')
      else if (token.startsWith('--tag=')) tags.push(token.slice('--tag='.length))
    })
  }
  return tags
}

/** Raw `tags:` values of a built `docker/build-push-action` step. */
function actionBuildTags(step: BuildStep): string[] | undefined {
  if (!step.uses?.startsWith('docker/build-push-action@') || !isBuildAction(step)) return undefined
  const tags = step.with?.tags
  return typeof tags === 'string' ? tags.split(/[\n,]/u) : []
}

export function collectLocalBuilds(steps: readonly BuildStep[]): LocalBuilds {
  const tags = new Set<string>()
  const stepIds = new Set<string>()
  const repositories = new Set<string>()
  const metadata = new Map<string, string[]>()
  for (const step of steps) {
    if (step.id && step.uses?.startsWith('docker/metadata-action@')) {
      const images = typeof step.with?.images === 'string' ? step.with.images.split(/[\n,]/u) : []
      metadata.set(
        step.id,
        images.flatMap((image) => recorded(image, step) ?? []),
      )
    }
    const built = runBuildTags(step.run ?? '') ?? actionBuildTags(step)
    if (built === undefined && !isBuildAction(step)) continue
    if (step.id) stepIds.add(step.id)
    for (const tag of built ?? []) {
      const value = recorded(tag, step)
      if (value) tags.add(value)
    }
    const used = [step.with?.tags, step.with?.files].filter((v) => typeof v === 'string').join('\n')
    for (const [id, images] of metadata) {
      if (used.includes(`steps.${id}.outputs.`)) images.forEach((image) => repositories.add(image))
    }
  }
  return { tags, stepIds, repositories }
}

/** Whether a normalized image reference is a locally built tag, repository or step output. */
export function isLocalBuild(image: string, builds: LocalBuilds): boolean {
  if (builds.tags.has(image)) return true
  if (!image.includes('@') && builds.repositories.has(repositoryOf(image))) return true
  const id = STEP_OUTPUT.exec(image)?.[1]
  return id !== undefined && builds.stepIds.has(id)
}
