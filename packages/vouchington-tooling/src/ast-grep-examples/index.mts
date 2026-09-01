import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import picomatch from 'picomatch'
import { parse as yamlLoad, stringify as yamlDump } from 'yaml'

interface AstGrepExample {
  code: string
  isValid: boolean
  file: string
}
interface Rule {
  id: string
  examples?: AstGrepExample[]
  files?: string[]
  ignores?: string[]
  [key: string]: unknown
}
interface LoadedRule {
  ruleFile: string
  rule: Rule
}
interface ValidatedLoadedRule extends LoadedRule {
  invalid: string
}
interface AstGrepResult {
  status: number | null
  stdout?: string
  stderr?: string
}
export type AstGrepExamplesExecutor = (args: readonly string[], cwd: string) => AstGrepResult
export interface AstGrepExamplesOptions {
  readonly rules: string
  readonly config: string
  readonly executable?: string
  readonly execute?: AstGrepExamplesExecutor
}
export function astGrepExamplesArguments(options: AstGrepExamplesOptions): string[] {
  return [
    'test',
    '--test-dir',
    needPath(options.rules, '--rules'),
    '--config',
    needPath(options.config, '--config'),
  ]
}
function needPath(value: string, option: string): string {
  if (!value) throw new Error(`${option} requires a path`)
  return value
}
function eligible(rule: Rule, file: string): boolean {
  const path = file.replace(/\\/g, '/').replace(/^\.\//, '')
  return (
    (!rule.files?.length || picomatch(rule.files)(path)) &&
    !(rule.ignores?.length && picomatch(rule.ignores)(path))
  )
}
function loadRules(directory: string): LoadedRule[] {
  return (readdirSync(directory, { recursive: true }) as string[])
    .filter((file) => /\.ya?ml$/u.test(file))
    .toSorted()
    .map((file) => {
      const ruleFile = join(directory, file)
      return { ruleFile, rule: yamlLoad(readFileSync(ruleFile, 'utf8')) as Rule }
    })
}
function assertExample(rule: Rule, example: AstGrepExample): void {
  if (!example.code || !example.file)
    throw new Error(`${rule.id}: examples require non-empty code and file`)
  safeRelativePath(example.file, `${rule.id}: example.file`)
}
function safeRelativePath(value: string, label: string): string {
  if (
    value.includes('\0') ||
    isAbsolute(value) ||
    value
      .replace(/\\/g, '/')
      .split('/')
      .some((component) => component === '..')
  )
    throw new Error(`${label} must stay within the temporary rule directory`)
  return value
}
function defaultExecute(executable: string): AstGrepExamplesExecutor {
  return (args, cwd) => {
    const result = spawnSync(executable, args, { cwd, encoding: 'utf8' })
    if (result.error) throw new Error(`ast-grep failed to spawn: ${result.error.message}`)
    return result
  }
}
function writeNativeTests(rules: LoadedRule[], testDir: string, semanticDir: string): void {
  for (const { rule } of rules) {
    if (!/^[A-Za-z0-9_.-]+$/u.test(rule.id))
      throw new Error('rule id must be a filesystem-safe name')
    const examples = rule.examples ?? []
    const invalid = [
      ...new Set(examples.filter((example) => !example.isValid).map((example) => example.code)),
    ]
    const valid = [
      ...new Set(
        examples
          .filter(
            (example) =>
              example.isValid && eligible(rule, example.file) && !invalid.includes(example.code),
          )
          .map((example) => example.code),
      ),
    ]
    writeFileSync(join(testDir, `${rule.id}.yml`), yamlDump({ id: rule.id, valid, invalid }))
    const { examples: _examples, files: _files, ignores: _ignores, ...semanticRule } = rule
    writeFileSync(join(semanticDir, `${rule.id}.yml`), yamlDump(semanticRule))
  }
}
function scanScopedRule(
  loaded: ValidatedLoadedRule,
  root: string,
  languageGlobs: Record<string, string[]>,
  execute: AstGrepExamplesExecutor,
): void {
  const { invalid, rule } = loaded
  const expected = new Map<string, boolean>()
  for (const example of rule.examples ?? []) {
    assertExample(rule, example)
    const file = example.file.replace(/\\/g, '/').replace(/^\.\//, '')
    expected.set(file, eligible(rule, file))
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, invalid)
  }
  copyFileSync(loaded.ruleFile, join(root, 'rule.yml'))
  writeFileSync(join(root, 'sgconfig.yml'), yamlDump({ languageGlobs }))
  const result = execute(
    ['scan', '--rule', 'rule.yml', '--config', 'sgconfig.yml', '--json', '--no-ignore', 'hidden'],
    root,
  )
  if (result.status !== null && result.status > 1)
    throw new Error(`ast-grep scan failed (exit ${result.status}): ${result.stderr ?? ''}`)
  const found = new Set(
    result.stdout?.trim()
      ? (JSON.parse(result.stdout) as Array<{ file: string }>).map((f) =>
          f.file.replace(/\\/g, '/').replace(/^\.\//, ''),
        )
      : [],
  )
  for (const [file, shouldFind] of expected)
    if (found.has(file) !== shouldFind)
      throw new Error(
        `${rule.id}: expected ${file} ${shouldFind ? 'to produce' : 'not to produce'} a finding`,
      )
}
export function runAstGrepExamples(options: AstGrepExamplesOptions): number {
  const rulesDirectory = resolve(needPath(options.rules, '--rules'))
  const config = resolve(needPath(options.config, '--config'))
  const languageGlobs = (
    yamlLoad(readFileSync(config, 'utf8')) as { languageGlobs?: Record<string, string[]> }
  ).languageGlobs
  if (!languageGlobs) throw new Error(`${config}: missing languageGlobs`)
  const rules = loadRules(rulesDirectory).map((loaded): ValidatedLoadedRule => {
    const { rule } = loaded
    const examples = rule.examples ?? []
    for (const example of examples) assertExample(rule, example)
    const invalid = examples.find((example) => !example.isValid)
    if (!examples.some((example) => example.isValid) || invalid === undefined)
      throw new Error(`${rule.id}: examples require valid and invalid cases`)
    return { ...loaded, invalid: invalid.code }
  })
  const execute = options.execute ?? defaultExecute(options.executable ?? 'ast-grep')
  const root = mkdtempSync(join(tmpdir(), 'ast-grep-examples-'))
  try {
    const tests = join(root, 'native-tests')
    const semantic = join(root, 'semantic-rules')
    mkdirSync(tests)
    mkdirSync(semantic)
    writeNativeTests(rules, tests, semantic)
    const nativeConfig = join(root, 'sgconfig.yml')
    writeFileSync(nativeConfig, yamlDump({ ruleDirs: [semantic] }))
    const native = execute(
      ['test', '--config', nativeConfig, '--test-dir', tests, '--skip-snapshot-tests'],
      process.cwd(),
    )
    if (native.status !== 0) throw new Error(`${native.stdout ?? ''}\n${native.stderr ?? ''}`)
    for (const loaded of rules.filter(({ rule }) => rule.files?.length || rule.ignores?.length)) {
      const scopedRoot = join(root, 'path-scans', loaded.rule.id)
      mkdirSync(scopedRoot, { recursive: true })
      scanScopedRule(loaded, scopedRoot, languageGlobs, execute)
    }
    return 0
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}
