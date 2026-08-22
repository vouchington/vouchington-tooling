import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { SharedContext } from '../shared-context/index.mts'
import type { WorkspaceGatesOptions } from './options.mts'

export const FIRST_PARTY_NAMES = ['acme-lib', '@acme/core'] as const
export const SCOPED_PREFIXES = ['@acme/'] as const
export const TEMPORARY_SELECTOR = 'demo-temporary-package@9.9.9'

export function defaultOptions(
  overrides: Partial<WorkspaceGatesOptions> = {},
): WorkspaceGatesOptions {
  return {
    firstPartyNames: FIRST_PARTY_NAMES,
    scopedPrefixes: SCOPED_PREFIXES,
    ...overrides,
  }
}

export function stubCtx(repoRoot: string, trackedFiles: readonly string[]): SharedContext {
  return {
    repoRoot,
    isInsideGitRepo: true,
    trackedFiles,
    trackedFileSet: new Set(trackedFiles),
  }
}

export function buildWorkspaceYaml(names: readonly string[] = FIRST_PARTY_NAMES): string {
  return `minimumReleaseAgeExclude:\n${names.map((name) => `  - '${name}'`).join('\n')}\n`
}

export function buildDependabotYaml(patterns: readonly string[] = [...FIRST_PARTY_NAMES]): string {
  return [
    'updates:',
    "  - package-ecosystem: 'npm'",
    "    directory: '/'",
    '    cooldown:',
    '      exclude:',
    ...patterns.map((pattern) => `        - '${pattern}'`),
    '',
  ].join('\n')
}

export function buildPackageJson(names: readonly string[] = FIRST_PARTY_NAMES): string {
  return `${JSON.stringify({ dependencies: Object.fromEntries(names.map((name) => [name, '^1.0.0'])) }, null, 2)}\n`
}

export function buildPnpmLock(
  keys: readonly string[] = ['acme-lib@1.0.0', '@acme/core@1.0.0'],
): string {
  const packages = keys.map((key) => `  '${key}':\n    resolution: {}\n`)
  return `lockfileVersion: '9.0'\npackages:\n${packages.join('')}`
}

export async function makeTmpDir(testDirs: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'workspace-gates-'))
  testDirs.push(dir)
  return dir
}

export async function writeTracked(
  repoRoot: string,
  files: Record<string, string>,
): Promise<string[]> {
  const relPaths: string[] = []
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(repoRoot, relPath)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, contents)
    relPaths.push(relPath)
  }
  return relPaths
}

export async function makeCompliantFixture(
  testDirs: string[],
  opts?: {
    names?: readonly string[]
    lockKeys?: readonly string[]
    extraFiles?: Record<string, string>
  },
): Promise<{ dir: string; files: string[] }> {
  const names = opts?.names ?? FIRST_PARTY_NAMES
  const dir = await makeTmpDir(testDirs)
  const files = await writeTracked(dir, {
    'pnpm-workspace.yaml': buildWorkspaceYaml(names),
    '.github/dependabot.yml': buildDependabotYaml(names),
    'package.json': buildPackageJson(names),
    'pnpm-lock.yaml': buildPnpmLock(opts?.lockKeys),
    ...opts?.extraFiles,
  })
  return { dir, files }
}
