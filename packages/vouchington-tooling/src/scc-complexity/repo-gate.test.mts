import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { parse as parseToml } from 'smol-toml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { repoRootFromModule, REPO_SCC_SCOPE, runRepoSccComplexity } from './repo-gate.mts'

const execFileAsync = promisify(execFile)
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

function read(file: string) {
  return readFileSync(resolve(moduleRoot, file), 'utf8')
}

function report(files: readonly { complexity: number; file: string }[]) {
  return JSON.stringify([
    { Files: files.map(({ complexity, file }) => ({ Complexity: complexity, Location: file })) },
  ])
}

describe('repository scc complexity gate', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  async function gitRepo(files: readonly string[], baseline: unknown) {
    const root = await mkdtemp(join(tmpdir(), 'repo-scc-'))
    dirs.push(root)
    await execFileAsync('git', ['init'], { cwd: root })
    for (const file of files) {
      await mkdir(dirname(join(root, file)), { recursive: true })
      await writeFile(join(root, file), 'export const value = true\n')
    }
    await writeFile(join(root, 'scc-complexity-baseline.json'), JSON.stringify(baseline))
    await execFileAsync('git', ['add', '.'], { cwd: root })
    return root
  }

  it('resolves this repository and keeps the vouchington ceiling', () => {
    expect(repoRootFromModule()).toBe(moduleRoot)
    expect(repoRootFromModule(new URL('.', import.meta.url))).toBe(moduleRoot)
    expect(REPO_SCC_SCOPE).toEqual({ includePaths: ['.'], name: 'source' })
  })

  it('accepts the checked-in ceilings and rejects a rise above one', async () => {
    const baseline = JSON.parse(read('scc-complexity-baseline.json')) as {
      entries: { complexity: number; file: string; scope: string }[]
      version: number
    }
    const atCeiling = report(
      baseline.entries.map((entry) => ({ complexity: entry.complexity, file: entry.file })),
    )
    await expect(runRepoSccComplexity(undefined, { runScc: async () => atCeiling })).resolves.toBe(
      0,
    )

    const raised = report(
      baseline.entries.map((entry, index) => ({
        complexity: entry.complexity + (index === 0 ? 1 : 0),
        file: entry.file,
      })),
    )
    const written: string[] = []
    const stderr = {
      write: (chunk: string) => {
        written.push(chunk)
        return true
      },
    }
    await expect(
      runRepoSccComplexity(moduleRoot, { command: 'scc', runScc: async () => raised, stderr }),
    ).resolves.toBe(1)
    expect(written.join('')).toContain(baseline.entries[0]?.file)
    expect(written.join('')).toContain('baseline ceiling')
  })

  it('fails a file over 50 that is not in the baseline', async () => {
    const root = await gitRepo(['src/new.mts'], { entries: [], version: 1 })
    const stderr: string[] = []
    await expect(
      runRepoSccComplexity(root, {
        runScc: async () => report([{ complexity: 51, file: 'src/new.mts' }]),
        stderr: { write: (chunk: string) => (stderr.push(chunk), true) },
      }),
    ).resolves.toBe(1)
    expect(stderr.join('')).toContain('src/new.mts')
  })

  it('fails when the checkout is not a git repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'repo-scc-nogit-'))
    dirs.push(root)
    await writeFile(join(root, 'scc-complexity-baseline.json'), '{"version":1,"entries":[]}')
    const stderr: string[] = []
    await expect(
      runRepoSccComplexity(root, {
        runScc: async () => report([]),
        stderr: { write: (chunk: string) => (stderr.push(chunk), true) },
      }),
    ).resolves.toBe(1)
    expect(stderr.join('')).toContain('not inside a git repository')
  })

  it('writes a failure to stderr when no stream is injected', async () => {
    const root = await gitRepo(['src/new.mts'], { entries: [], version: 1 })
    const written: string[] = []
    const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))
      return true
    })
    try {
      await expect(
        runRepoSccComplexity(root, {
          runScc: async () => report([{ complexity: 51, file: 'src/new.mts' }]),
        }),
      ).resolves.toBe(1)
    } finally {
      write.mockRestore()
    }
    expect(written.join('')).toContain('src/new.mts')
  })
})

describe('repository scc complexity wiring', () => {
  const baseline = JSON.parse(read('scc-complexity-baseline.json')) as {
    entries: { complexity: number; file: string; scope: string }[]
    version: number
  }
  const doc = read('docs/scc-complexity.md')
  const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

  it('pins scc 3.7.0 and runs that pin from lint after CI installs it', () => {
    const tools = parseToml(read('.mise.toml')) as { tools: Record<string, string> }
    expect(tools.tools['github:boyter/scc']).toBe('3.7.0')
    expect(packageJson.scripts['scc-complexity']).toBe(
      'mise exec -- node --experimental-strip-types packages/vouchington-tooling/src/scc-complexity/repo-cli.mts',
    )
    expect(packageJson.scripts.lint).toContain('pnpm run scc-complexity')
    expect(doc).toContain('3.7.0')
    expect(doc).toContain('50')
    expect(doc).toContain('scc-complexity-baseline.json')

    const ci = read('.github/workflows/ci.yml')
    const testJob = ci.slice(ci.indexOf('\n  test:\n'), ci.indexOf('\n  test-macos:\n'))
    const workflow = parseYaml(ci) as {
      jobs: {
        test: {
          steps: { 'timeout-minutes'?: number; uses?: string; with?: { cache?: boolean } }[]
        }
      }
    }
    const mise = workflow.jobs.test.steps.find((step) => step.uses?.startsWith('jdx/mise-action@'))
    expect(mise?.uses).toMatch(/^jdx\/mise-action@[0-9a-f]{40}$/)
    expect(testJob).toMatch(/jdx\/mise-action@[0-9a-f]{40} # v\d+\.\d+\.\d+/)
    expect(mise?.with).toEqual({ cache: false })
    expect(mise?.['timeout-minutes']).toBe(3)
    expect(testJob.indexOf('jdx/mise-action@')).toBeLessThan(testJob.indexOf('pnpm run lint'))
  })

  it('records only source files still over the ceiling, in path order', () => {
    expect(baseline.version).toBe(1)
    expect(baseline.entries.length).toBeGreaterThan(0)
    const files = baseline.entries.map((entry) => entry.file)
    expect(files).toEqual([...files].toSorted())
    for (const entry of baseline.entries) {
      expect(entry.scope).toBe('source')
      expect(entry.complexity).toBeGreaterThan(50)
      expect(entry.file).not.toMatch(/\.(test|spec)\./)
      expect(entry.file.split('/')).not.toContain('fixtures')
      expect(entry.file.split('/')).not.toContain('test-helpers')
      expect(read(entry.file).length).toBeGreaterThan(0)
    }
  })
})
