import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { buildSharedContext, type SharedContext } from '../../shared-context/index.mts'
import { checkTrivyPolicy, type TrivyPolicyOptions } from '../../trivy-policy/index.mts'
import { commandUsage } from '../usage.mts'

interface Dependencies {
  readonly buildContext?: (root: string) => Promise<SharedContext>
  readonly stdout?: Pick<NodeJS.WritableStream, 'write'>
  readonly stderr?: Pick<NodeJS.WritableStream, 'write'>
}

function integer(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d{1,5}$/.test(value)) throw new Error(`--${name} must be an integer from 0 to 99999`)
  return Number(value)
}

function parseOptions(args: readonly string[]): { root: string; options: TrivyPolicyOptions } {
  const { values } = parseArgs({
    args: [...args],
    allowPositionals: false,
    options: {
      root: { type: 'string' },
      'ignore-file': { type: 'string' },
      'findings-exit-code-env': { type: 'string' },
      'cleanup-url-prefix': { type: 'string' },
      'min-gates': { type: 'string' },
      'min-sboms': { type: 'string' },
      'max-expiry-days': { type: 'string' },
    },
  })
  const envName = values['findings-exit-code-env']
  if (envName !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName))
    throw new Error('--findings-exit-code-env must be an environment variable name')
  const minGates = integer('min-gates', values['min-gates'])
  const minSboms = integer('min-sboms', values['min-sboms'])
  const maxExpiryDays = integer('max-expiry-days', values['max-expiry-days'])
  return {
    root: resolve(values.root ?? process.cwd()),
    options: {
      ...(values['ignore-file'] === undefined ? {} : { ignoreFile: values['ignore-file'] }),
      ...(values['findings-exit-code-env'] === undefined
        ? {}
        : { findingsExitCodeEnv: values['findings-exit-code-env'] }),
      ...(values['cleanup-url-prefix'] === undefined
        ? {}
        : { cleanupUrlPrefix: values['cleanup-url-prefix'] }),
      ...(minGates === undefined ? {} : { minGates }),
      ...(minSboms === undefined ? {} : { minSboms }),
      ...(maxExpiryDays === undefined ? {} : { maxExpiryDays }),
    },
  }
}

/**
 * `vouchington trivy-policy [--root <dir>] [--ignore-file <path>] ...`: prints each violation of the
 * tracked Trivy policy to stderr and exits 1; exits 2 on a usage error and 0 when compliant.
 */
export async function runTrivyPolicyCommand(
  args: readonly string[],
  dependencies: Dependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  let parsed: ReturnType<typeof parseOptions>
  try {
    parsed = parseOptions(args)
  } catch (error) {
    stderr.write(`vouchington: ${(error as Error).message}\n${commandUsage('trivy-policy')}`)
    return 2
  }
  const context = await (dependencies.buildContext ?? buildSharedContext)(parsed.root)
  if (!context.isInsideGitRepo) {
    stderr.write(`vouchington: ${parsed.root} is not inside a git repository\n`)
    return 1
  }
  const violations = checkTrivyPolicy(context.repoRoot, context.trackedFiles, parsed.options)
  if (violations.length === 0) {
    stdout.write('Trivy policy: ok\n')
    return 0
  }
  stderr.write(`${violations.join('\n')}\n`)
  return 1
}
