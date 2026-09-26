import { dockerOptions } from './docker-options.mts'
import { visitRunSteps, type GhaFileKind } from './shared.mts'

const WORKSPACE_RE = /(?:\$\{?GITHUB_WORKSPACE\}?|\$\{\{\s*github\.workspace\s*\}\})/iu

export function checkDockerWorkspaceUserDocument(
  file: string,
  document: unknown,
  kind: GhaFileKind,
  errors: string[],
): void {
  visitRunSteps(document, kind === 'action', (scope, index, step) => {
    if (typeof step.run !== 'string') return
    for (const block of dockerRunBlocks(step.run)) {
      const options = dockerOptions(block)
      if (!options) continue
      const writable = options.volumes.filter(
        (volume) => WORKSPACE_RE.test(volume) && !isReadOnlyVolume(volume),
      )
      if (writable.length === 0 || hasHostUserMapping(options.user)) continue
      errors.push(
        `::error file=${file}::${file}: ${scope} step ${index} runs Docker with a writable ` +
          `GITHUB_WORKSPACE mount (${writable.join(', ')}) but no --user host UID:GID mapping. ` +
          'Use --user "$(id -u):$(id -g)" or make the workspace mount read-only.',
      )
    }
  })
}

function dockerRunBlocks(run: string): string[] {
  const blocks: string[] = []
  const lines = run.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (!/\bdocker\b/u.test(lines[index]!)) continue
    let block = lines[index]!
    while (block.trimEnd().endsWith('\\') && index + 1 < lines.length) {
      index += 1
      block = `${block.trimEnd().slice(0, -1)} ${lines[index]!}`
    }
    blocks.push(block)
  }
  return blocks
}

function hasHostUserMapping(value: string | undefined): boolean {
  return value !== undefined && /^\$\(\s*id\s+-u\s*\):\$\(\s*id\s+-g\s*\)$/u.test(value)
}

function isReadOnlyVolume(value: string): boolean {
  return /(?:^|:)ro(?:$|,)/u.test(value) || /(?:^|,)readonly(?:$|,)/u.test(value)
}
