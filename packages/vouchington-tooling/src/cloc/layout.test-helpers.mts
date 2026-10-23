import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { normalizeClocConfig, type ClocConfig, type ClocConfigInput } from './config.mts'

export const LAYOUT: ClocConfigInput = {
  services: [
    { name: 'api', match: ['api/'] },
    { name: 'ui', match: ['ui/', 'e2e/'] },
    { name: 'docs', match: ['docs/', 'README.md'] },
  ],
  defaultService: 'tooling',
  testPatterns: ['*.test.*', '**/__tests__/**', 'e2e/'],
  toolingPatterns: ['.github/', '**/scripts/**', 'package.json', '*.config.*'],
  countedRoots: ['.github', 'api', 'docs', 'e2e', 'scripts', 'ui'],
  countedRootFiles: ['README.md', 'package.json', 'missing.json'],
}

export function layoutConfig(overrides: ClocConfigInput = {}): ClocConfig {
  return normalizeClocConfig({ ...LAYOUT, ...overrides })
}

export function tempRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'cloc-'))
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })
  return root
}

/** An executable stand-in for scc that prints the given stdout and exits with `status`. */
export function fakeScc(stdout: string, status = 0): string {
  const file = join(mkdtempSync(join(tmpdir(), 'scc-')), 'scc')
  writeFileSync(
    file,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(stdout)})\nprocess.exit(${status})\n`,
  )
  chmodSync(file, 0o755)
  return file
}

export const SCC_HEADER = 'Language,Provider,Filename,Lines,Code,Comments,Blanks,Complexity,Bytes\n'

export function sccCsv(rows: Record<string, number>): string {
  const body = Object.entries(rows).map(
    ([path, code]) => `TypeScript,${path},x,${code},${code},0,0,0,0\n`,
  )
  return SCC_HEADER + body.join('')
}
