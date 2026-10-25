import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { checkCoverageScope } from '../../coverage-scope/check.mts'
import { commandUsage } from '../usage.mts'

interface Options {
  rules: string
  include: string[]
  exclude: string[]
}

function readGlobs(path: string, value: unknown, name: string): string[] {
  if (value === undefined) return []
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value
  throw new Error(`${path}: "${name}" must be an array of strings`)
}

function parse(args: readonly string[]): Options {
  const { values } = parseArgs({
    args: [...args],
    allowPositionals: false,
    options: {
      rules: { type: 'string', default: '.coverage-rules.yml' },
      'scope-file': { type: 'string' },
      include: { type: 'string', multiple: true, default: [] },
      exclude: { type: 'string', multiple: true, default: [] },
    },
  })
  const path = values['scope-file']
  const file =
    path === undefined ? {} : (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
  const include = [...readGlobs(String(path), file.include, 'include'), ...values.include]
  if (include.length === 0) throw new Error('at least one include glob is required')
  return {
    rules: values.rules,
    include,
    exclude: [...readGlobs(String(path), file.exclude, 'exclude'), ...values.exclude],
  }
}

/**
 * `vouchington coverage-scope-check [--rules <path>] [--scope-file <json>] [--include <glob>]...
 * [--exclude <glob>]...`: fails when a tracked file under a positive-threshold coverage rule is not
 * instrumented by the given include/exclude globs. Exits 0 on success, 2 on a usage error, 1 on a
 * mismatch or when the rules cannot be loaded.
 */
export function runCoverageScopeCheckCommand(
  args: readonly string[],
  cwd: string = process.cwd(),
): number {
  let options: Options
  try {
    options = parse(args)
  } catch (error) {
    const message = (error as Error).message
    process.stderr.write(`vouchington: ${message}\n${commandUsage('coverage-scope-check')}`)
    return 2
  }
  try {
    const mismatches = checkCoverageScope({
      cwd,
      rulesFile: options.rules,
      instrumentedScope: options,
    })
    if (mismatches.length === 0) return 0
    const lines = mismatches.map((file) => `  ${file}`).join('\n')
    process.stderr.write(
      `Coverage rules require files that the collector does not instrument:\n${lines}\n`,
    )
    return 1
  } catch (error) {
    process.stderr.write(`vouchington: ${(error as Error).message}\n`)
    return 1
  }
}
