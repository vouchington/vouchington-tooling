import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface AstGrepRuleInvocation {
  readonly ruleId: string
  readonly passthrough: readonly string[]
}

export interface RunAstGrepRuleOptions {
  readonly args: readonly string[]
  readonly cwd?: string
  readonly rulesDirectory?: string
  readonly executable?: string
  readonly defaultScanArguments?: readonly string[]
}

export function parseAstGrepRuleArgs(args: readonly string[]): AstGrepRuleInvocation {
  const normalized = args[0] === '--' ? args.slice(1) : args
  const [ruleId, ...passthrough] = normalized
  if (!ruleId) throw new Error('Expected an AST-grep rule id')
  if (ruleId.startsWith('-') || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(ruleId)) {
    throw new Error(`Invalid AST-grep rule id: ${ruleId}`)
  }
  return { ruleId, passthrough }
}

function containedRulePath(rulesDirectory: string, ruleId: string): string {
  const root = realpathSync(rulesDirectory)
  const path = realpathSync(join(root, `${ruleId}.yml`))
  if (resolve(path).startsWith(`${resolve(root)}/`)) return path
  throw new Error(`AST-grep rule resolves outside the rules directory: ${ruleId}`)
}

export function runAstGrepRule(options: RunAstGrepRuleOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd()
  const rulesDirectory = resolve(cwd, options.rulesDirectory ?? 'ast-grep-rules')
  const { ruleId, passthrough } = parseAstGrepRuleArgs(options.args)
  const unresolvedRulePath = join(rulesDirectory, `${ruleId}.yml`)
  if (!existsSync(unresolvedRulePath)) throw new Error(`Unknown AST-grep rule id: ${ruleId}`)
  const rulePath = containedRulePath(rulesDirectory, ruleId)
  const executable = resolve(
    cwd,
    options.executable ?? join('node_modules', '@ast-grep', 'cli', 'ast-grep'),
  )
  const defaults = options.defaultScanArguments ?? [
    '--no-ignore',
    'hidden',
    '--off=unused-suppression',
  ]
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, ['scan', ...defaults, '--rule', rulePath, ...passthrough], {
      cwd,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', (code) => resolveResult(code ?? 1))
  })
}
