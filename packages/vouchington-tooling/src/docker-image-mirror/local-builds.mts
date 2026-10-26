import { withoutShellComment } from '../trivy-policy/shell.mts'

// Images a workflow file or composite action builds locally are never pulled, so a registry
// allowlist or digest pin cannot apply to them. Only literal tags count: a tag containing an
// expression or shell variable cannot be matched and is skipped.
export type BuildStep = {
  id?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
}

export interface LocalBuilds {
  readonly tags: ReadonlySet<string>
  readonly stepIds: ReadonlySet<string>
}

const STEP_OUTPUT = /^\$\{\{\s*steps\.([\w-]+)\.outputs\.[\w-]+\s*\}\}$/u
// A build counts only at a command position, not as text inside `echo` or another argument.
const BUILD_COMMAND =
  /(?:^|[;&|(]|\b(?:sudo|then|do|else))[ \t]*(?:docker\s+(?:buildx\s+)?|podman\s+)build\b([^\n;&|]*)/gmu

function literal(tag: string): string | undefined {
  const value = tag.trim().replace(/^(["'])(.*)\1$/u, '$2')
  return value === '' || /\$|\{\{/u.test(value) ? undefined : value
}

/** Raw tag values of every build command in a script, or undefined when it builds nothing. */
function runBuildTags(script: string): string[] | undefined {
  const logical = withoutShellComment(script).replace(/\\\r?\n/gu, ' ')
  const commands = [...logical.matchAll(BUILD_COMMAND)]
  if (commands.length === 0) return undefined
  const tags: string[] = []
  for (const [, args] of commands) {
    const tokens = args!.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/gu) ?? []
    tokens.forEach((token, i) => {
      if (token === '-t' || token === '--tag') tags.push(tokens[i + 1] ?? '')
      else if (token.startsWith('--tag=')) tags.push(token.slice('--tag='.length))
    })
  }
  return tags
}

/** Raw `tags:` values of a `docker/build-push-action` step with `load: true`. */
function actionBuildTags(step: BuildStep): string[] | undefined {
  const load = step.with?.load
  if (!step.uses?.startsWith('docker/build-push-action@') || (load !== true && load !== 'true')) {
    return undefined
  }
  const tags = step.with?.tags
  return typeof tags === 'string' ? tags.split(/[\n,]/u) : []
}

export function collectLocalBuilds(steps: readonly BuildStep[]): LocalBuilds {
  const tags = new Set<string>()
  const stepIds = new Set<string>()
  for (const step of steps) {
    const built = runBuildTags(step.run ?? '') ?? actionBuildTags(step)
    if (built === undefined) continue
    if (step.id) stepIds.add(step.id)
    for (const tag of built) {
      const value = literal(tag)
      if (value) tags.add(value)
    }
  }
  return { tags, stepIds }
}

/** Whether a (quote-stripped) image reference is a locally built tag or a build step's output. */
export function isLocalBuild(image: string, builds: LocalBuilds): boolean {
  if (builds.tags.has(image)) return true
  const id = STEP_OUTPUT.exec(image)?.[1]
  return id !== undefined && builds.stepIds.has(id)
}
