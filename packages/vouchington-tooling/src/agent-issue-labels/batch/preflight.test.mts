import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BatchEntry, BatchManifest } from './manifest.mts'
import { executePreflight, type PreflightDeps } from './preflight.mts'

const fixtureDir = mkdtempSync(join(tmpdir(), 'batch-preflight-'))
const labelerPath = join(fixtureDir, 'labeler.yml')
writeFileSync(labelerPath, "tooling:\n  - changed-files:\n      - any-glob-to-any-file: 'dev/**'\n")

function makeEntry(overrides: Partial<BatchEntry> = {}): BatchEntry {
  const title = overrides.title ?? 'Fix the thing'
  return {
    id: 'e1',
    title,
    bodyFile: 'body-e1.md',
    paths: ['dev/agent-issue-labels/batch/manifest.mts'],
    priority: 'priority: medium',
    dependencies: [],
    milestone: null,
    extraLabels: [],
    duplicateSearch: { query: title, acknowledgedHits: [], acknowledgedSiblings: [] },
    ...overrides,
  }
}

function makeManifest(entries: BatchEntry[]): BatchManifest {
  return { targetRepo: 'example/app', entries }
}

type DuplicatesByTitle = Record<string, Array<{ number: number; title: string; url: string }>>

function makeRunGh(options: {
  labels?: string[]
  milestones?: string[]
  duplicatesByTitle?: DuplicatesByTitle
}) {
  const {
    labels = ['priority: medium', 'tooling'],
    milestones = [],
    duplicatesByTitle = {},
  } = options
  const calls: string[][] = []
  const runGh = async (args: string[]): Promise<string> => {
    calls.push(args)
    if (args[0] === 'auth') return ''
    if (args[0] === 'api') {
      const endpoint = args.find((arg) => arg.startsWith('repos/')) ?? ''
      if (endpoint.includes('/labels')) return JSON.stringify([labels.map((name) => ({ name }))])
      if (endpoint.includes('/milestones')) {
        return JSON.stringify([milestones.map((title) => ({ title }))])
      }
      throw new Error(`unexpected api endpoint: ${endpoint}`)
    }
    if (args[0] === 'issue' && args[1] === 'list') {
      const searchTerm = args[args.indexOf('--search') + 1] ?? ''
      const title = searchTerm.replace(/ in:title$/, '')
      return JSON.stringify(duplicatesByTitle[title] ?? [])
    }
    throw new Error(`unexpected gh invocation: ${args.join(' ')}`)
  }
  return { runGh, calls }
}

function makeDeps(
  overrides: Partial<PreflightDeps> & { runGh: PreflightDeps['runGh'] },
): PreflightDeps {
  return {
    pathExists: async () => true,
    readBody: async () => 'body',
    labelerPath,
    sessionDir: fixtureDir,
    ...overrides,
  }
}

describe('executePreflight', () => {
  it('passes an entry whose labels, milestone, and paths all resolve cleanly', async () => {
    const manifest = makeManifest([makeEntry()])
    const { runGh } = makeRunGh({})
    const report = await executePreflight(manifest, makeDeps({ runGh }))

    expect(report.status).toBe('pass')
    expect(report.entries[0]!.status).toBe('pass')
    expect([...report.entries[0]!.resolvedLabels].toSorted()).toEqual([
      'priority: medium',
      'tooling',
    ])
    expect(report.entries[0]!.blocked).toEqual([])
  })

  it('blocks on a label not present in the live taxonomy', async () => {
    const manifest = makeManifest([makeEntry({ extraLabels: ['does-not-exist'] })])
    const { runGh } = makeRunGh({})
    const report = await executePreflight(manifest, makeDeps({ runGh }))

    expect(report.status).toBe('blocked')
    expect(report.entries[0]!.blocked).toContainEqual(
      expect.objectContaining({ code: 'unknown-label' }),
    )
  })

  it('blocks on a milestone not present in the live taxonomy', async () => {
    const manifest = makeManifest([makeEntry({ milestone: 'v2' })])
    const { runGh } = makeRunGh({ milestones: ['v1'] })
    const report = await executePreflight(manifest, makeDeps({ runGh }))

    expect(report.entries[0]!.blocked).toContainEqual(
      expect.objectContaining({ code: 'unknown-milestone' }),
    )
  })

  it('accepts a milestone present in the live taxonomy', async () => {
    const manifest = makeManifest([makeEntry({ milestone: 'v1' })])
    const { runGh } = makeRunGh({ milestones: ['v1'] })
    const report = await executePreflight(manifest, makeDeps({ runGh }))

    expect(report.entries[0]!.status).toBe('pass')
    expect(report.entries[0]!.milestone).toBe('v1')
  })

  it('blocks on a manifest path that does not exist on disk', async () => {
    const manifest = makeManifest([makeEntry({ paths: ['dev/does-not-exist.mts'] })])
    const { runGh } = makeRunGh({})
    const report = await executePreflight(
      manifest,
      makeDeps({ runGh, pathExists: async (path) => path !== 'dev/does-not-exist.mts' }),
    )

    expect(report.entries[0]!.blocked).toContainEqual(
      expect.objectContaining({ code: 'missing-paths' }),
    )
  })

  it('blocks when the body file cannot be read', async () => {
    const manifest = makeManifest([makeEntry()])
    const { runGh } = makeRunGh({})
    const report = await executePreflight(
      manifest,
      makeDeps({
        runGh,
        readBody: async () => {
          throw new Error('ENOENT')
        },
      }),
    )

    expect(report.entries[0]!.blocked).toContainEqual(
      expect.objectContaining({ code: 'body-unreadable' }),
    )
  })

  it('never short-circuits: reports every failing check on one entry at once', async () => {
    const manifest = makeManifest([
      makeEntry({ extraLabels: ['nope'], milestone: 'v9', paths: ['missing/path.mts'] }),
    ])
    const { runGh } = makeRunGh({ milestones: [] })
    const report = await executePreflight(
      manifest,
      makeDeps({ runGh, pathExists: async () => false }),
    )

    const codes = report.entries[0]!.blocked.map((reason) => reason.code).toSorted()
    expect(codes).toEqual(['missing-paths', 'unknown-label', 'unknown-milestone'])
  })

  it('fetches the taxonomy exactly once and bounds gh calls to 2 + N duplicate searches', async () => {
    const manifest = makeManifest([
      makeEntry({ id: 'e1' }),
      makeEntry({ id: 'e2' }),
      makeEntry({ id: 'e3' }),
    ])
    const { runGh, calls } = makeRunGh({})
    await executePreflight(manifest, makeDeps({ runGh }))

    const labelCalls = calls.filter(
      (call) => call[0] === 'api' && call.some((arg) => arg.includes('/labels')),
    )
    const milestoneCalls = calls.filter(
      (call) => call[0] === 'api' && call.some((arg) => arg.includes('/milestones')),
    )
    const searchCalls = calls.filter((call) => call[0] === 'issue' && call[1] === 'list')

    expect(calls.some((call) => call[0] === 'auth')).toBe(false)
    expect(labelCalls).toHaveLength(1)
    expect(milestoneCalls).toHaveLength(1)
    expect(searchCalls).toHaveLength(3)
    expect(calls).toHaveLength(5)
  })

  it('auto-adds the caller-required dependencies label when entry.dependencies is non-empty', async () => {
    const manifest = makeManifest([makeEntry({ dependencies: ['some-package'] })])
    const { runGh } = makeRunGh({ labels: ['priority: medium', 'tooling', 'dependencies'] })
    const report = await executePreflight(manifest, makeDeps({ runGh }))

    expect(report.entries[0]!.status).toBe('pass')
    expect(report.entries[0]!.resolvedLabels).toContain('dependencies')
  })

  it('requests only open milestones from the taxonomy API', async () => {
    const manifest = makeManifest([makeEntry()])
    const { runGh, calls } = makeRunGh({})
    await executePreflight(manifest, makeDeps({ runGh }))

    const milestoneCall = calls.find(
      (call) => call[0] === 'api' && call.some((arg) => arg.includes('/milestones')),
    )
    expect(milestoneCall).toContain('state=open')
    expect(milestoneCall).not.toContain('state=all')
  })

  // Reinterprets #8152's original "mixed-repository success" case: batch preflight is
  // single-repo only (see README § Scope), so "mixed" here means one entry combining
  // multiple classifications (milestone + dependencies) passing alongside a plain
  // entry in the same preflight run, rather than a mix of destination repositories.
  it('passes a batch mixing a milestone+dependency entry with a plain entry in one run', async () => {
    const manifest = makeManifest([
      makeEntry({ id: 'e1', title: 'Plain entry' }),
      makeEntry({
        id: 'e2',
        title: 'Milestone and dependency entry',
        milestone: 'v1',
        dependencies: ['some-package'],
      }),
    ])
    const { runGh } = makeRunGh({
      labels: ['priority: medium', 'tooling', 'dependencies'],
      milestones: ['v1'],
    })
    const report = await executePreflight(manifest, makeDeps({ runGh }))

    expect(report.status).toBe('pass')
    expect(report.entries.map((entry) => entry.status)).toEqual(['pass', 'pass'])
    expect(report.entries[1]!.milestone).toBe('v1')
    expect(report.entries[1]!.resolvedLabels).toContain('dependencies')
  })

  it('marks the overall report blocked when any single entry is blocked', async () => {
    const manifest = makeManifest([
      makeEntry({ id: 'e1', title: 'Fix the login bug' }),
      makeEntry({ id: 'e2', title: 'Add dark mode toggle', extraLabels: ['nope'] }),
    ])
    const { runGh } = makeRunGh({})
    const report = await executePreflight(manifest, makeDeps({ runGh }))

    expect(report.status).toBe('blocked')
    expect(report.entries[0]!.status).toBe('pass')
    expect(report.entries[1]!.status).toBe('blocked')
  })
})
