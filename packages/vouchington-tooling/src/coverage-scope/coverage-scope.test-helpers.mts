import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach } from 'vitest'

const RULES = [
  'scope:',
  '  version: 1',
  '  analyzer: javascript',
  '  include: ["**/*.mts"]',
  '  ignored: ["**/*.test.mts"]',
  'rules:',
  '  - paths: "app/**"',
  '    patch_coverage_min: 1',
  '  - paths: "scripts/**"',
  '    patch_coverage_min: 0',
  '',
].join('\n')

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A temp directory holding `.coverage-rules.yml` and the given files, optionally a git repo. */
export function fixtureRepo(files: readonly string[], options: { git: boolean }): string {
  const cwd = mkdtempSync(join(tmpdir(), 'coverage-scope-'))
  dirs.push(cwd)
  writeFileSync(join(cwd, '.coverage-rules.yml'), RULES)
  for (const file of files) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true })
    writeFileSync(join(cwd, file), 'export const fixture = true\n')
  }
  if (options.git) {
    execFileSync('git', ['init', '--quiet'], { cwd })
    execFileSync('git', ['add', '--', '.coverage-rules.yml', ...files], { cwd })
  }
  return cwd
}
