import { parseArgs } from 'node:util'
import { runDeadCodeGate, type DeadCodeGateResult, type DeadCodeOperation } from './gate.mts'

export const USAGE =
  'Usage: vouchington dead-code --baseline <path> [--seed|--update] [--config <path>] ' +
  '[--binary <path>] [--repo-root <path>] [--entry <glob>]... [--snapshot-ignore <glob>]... ' +
  '[--exclude <glob>]...'

type Output = Pick<Console, 'error' | 'log'>

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function summary(result: DeadCodeGateResult): string {
  const { identities, trackedFiles, removed } = result
  if (result.operation === 'seed') {
    return `Seeded dead-code baseline with ${identities} identities from ${trackedFiles} tracked files`
  }
  if (result.operation === 'update') {
    return `Dead-code baseline removed ${removed} stale identities; ${identities} remain`
  }
  return `Dead-code baseline matches ${identities} identities across ${trackedFiles} tracked files`
}

/** Runs `vouchington dead-code`. Returns 2 for usage errors and 1 for gate failures. */
export async function runDeadCodeCli(
  argv: readonly string[],
  output: Output = console,
): Promise<number> {
  let values
  try {
    ;({ values } = parseArgs({
      args: [...argv],
      options: {
        baseline: { type: 'string' },
        seed: { type: 'boolean' },
        update: { type: 'boolean' },
        config: { type: 'string' },
        binary: { type: 'string' },
        'repo-root': { type: 'string' },
        entry: { type: 'string', multiple: true },
        'snapshot-ignore': { type: 'string', multiple: true },
        exclude: { type: 'string', multiple: true },
      },
      strict: true,
    }))
  } catch (err) {
    output.error(`${USAGE}\n${message(err)}`)
    return 2
  }
  if (!values.baseline) {
    output.error(`${USAGE}\n--baseline is required`)
    return 2
  }
  if (values.seed && values.update) {
    output.error(`${USAGE}\n--seed and --update are mutually exclusive`)
    return 2
  }
  const operation: DeadCodeOperation = values.seed ? 'seed' : values.update ? 'update' : 'check'
  try {
    const result = await runDeadCodeGate({
      repoRoot: values['repo-root'] ?? process.cwd(),
      baselinePath: values.baseline,
      operation,
      configPath: values.config,
      binary: values.binary,
      entryRoots: values.entry,
      snapshotIgnore: values['snapshot-ignore'],
      excludeFindings: values.exclude,
    })
    output.log(summary(result))
    return 0
  } catch (err) {
    output.error(message(err))
    return 1
  }
}
