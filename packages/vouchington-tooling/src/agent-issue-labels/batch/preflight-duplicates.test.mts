import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BatchEntry, BatchManifest } from './manifest.mts'
import { executePreflight, type PreflightDeps } from './preflight.mts'

// Split out from batch-preflight.test.mts (which stayed near the 300-line cap) to cover the
// fail-closed duplicate-detection contract: every `gh issue list --search` hit and every
// intra-batch title collision blocks unless explicitly acknowledged in the manifest, plus the
// duplicate-priority and empty-body checks that round out the preflight block-reason list.
const fixtureDir = mkdtempSync(join(tmpdir(), 'batch-preflight-dup-'))
const labelerPath = join(fixtureDir, 'labeler.yml')
writeFileSync(labelerPath, "tooling:\n  - changed-files:\n      - any-glob-to-any-file: 'dev/**'\n")

function makeEntry(overrides: Partial<BatchEntry> = {}): BatchEntry {
  const title = overrides.title ?? 'Fix the thing'
  return {
    id: 'e1',
    title,
    bodyFile: 'body-e1.md',
    paths: [],
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

function makeRunGh(options: { labels?: string[]; duplicatesByTitle?: DuplicatesByTitle }) {
  const { labels = ['priority: medium', 'priority: high', 'tooling'], duplicatesByTitle = {} } =
    options
  const runGh = async (args: string[]): Promise<string> => {
    if (args[0] === 'auth') return ''
    if (args[0] === 'api') {
      const endpoint =
        args.find((arg) => arg.includes('/labels') || arg.includes('/milestones')) ?? ''
      if (endpoint.includes('/labels')) return JSON.stringify([labels.map((name) => ({ name }))])
      if (endpoint.includes('/milestones')) return JSON.stringify([[]])
      throw new Error(`unexpected api endpoint: ${endpoint}`)
    }
    if (args[0] === 'issue' && args[1] === 'list') {
      const searchTerm = args[args.indexOf('--search') + 1] ?? ''
      const title = searchTerm.replace(/ in:title$/, '')
      return JSON.stringify(duplicatesByTitle[title] ?? [])
    }
    throw new Error(`unexpected gh invocation: ${args.join(' ')}`)
  }
  return { runGh }
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

describe('executePreflight duplicate detection', () => {
  it('blocks on a likely duplicate of an existing issue', async () => {
    const manifest = makeManifest([makeEntry({ title: 'Fix the thing' })])
    const { runGh } = makeRunGh({
      duplicatesByTitle: {
        'Fix the thing': [{ number: 42, title: 'Fix the thing', url: 'https://example.com/42' }],
      },
    })
    const report = await executePreflight(manifest, makeDeps({ runGh }))

    expect(report.entries[0]!.blocked).toContainEqual(
      expect.objectContaining({ code: 'duplicate-existing' }),
    )
  })

  it('passes despite a search hit when its number is in acknowledgedHits', async () => {
    const manifest = makeManifest([
      makeEntry({
        title: 'Fix the thing',
        duplicateSearch: {
          query: 'Fix the thing',
          acknowledgedHits: [42],
          acknowledgedSiblings: [],
        },
      }),
    ])
    const { runGh } = makeRunGh({
      duplicatesByTitle: {
        'Fix the thing': [{ number: 42, title: 'Fix the thing', url: 'https://example.com/42' }],
      },
    })
    const report = await executePreflight(manifest, makeDeps({ runGh }))

    expect(report.entries[0]!.status).toBe('pass')
    expect(report.entries[0]!.blocked).toEqual([])
  })

  it('blocks both sides of a similar-title pair within the same batch', async () => {
    const manifest = makeManifest([
      makeEntry({ id: 'e1', title: 'Fix the login bug' }),
      makeEntry({ id: 'e2', title: 'Fix the login bug urgently' }),
    ])
    const { runGh } = makeRunGh({})
    const report = await executePreflight(manifest, makeDeps({ runGh }))

    expect(report.entries[0]!.blocked).toContainEqual(
      expect.objectContaining({ code: 'duplicate-in-batch' }),
    )
    expect(report.entries[1]!.blocked).toContainEqual(
      expect.objectContaining({ code: 'duplicate-in-batch' }),
    )
  })

  it('passes both sides of a similar-title pair that mutually acknowledge each other', async () => {
    const manifest = makeManifest([
      makeEntry({
        id: 'e1',
        title: 'Fix the login bug',
        duplicateSearch: {
          query: 'Fix the login bug',
          acknowledgedHits: [],
          acknowledgedSiblings: ['e2'],
        },
      }),
      makeEntry({
        id: 'e2',
        title: 'Fix the login bug urgently',
        duplicateSearch: {
          query: 'Fix the login bug urgently',
          acknowledgedHits: [],
          acknowledgedSiblings: ['e1'],
        },
      }),
    ])
    const { runGh } = makeRunGh({})
    const report = await executePreflight(manifest, makeDeps({ runGh }))

    expect(report.status).toBe('pass')
  })

  it('blocks on more than one resolved priority label', async () => {
    const manifest = makeManifest([makeEntry({ extraLabels: ['priority: high'] })])
    const { runGh } = makeRunGh({})
    const report = await executePreflight(manifest, makeDeps({ runGh }))

    expect(report.entries[0]!.blocked).toContainEqual(
      expect.objectContaining({ code: 'duplicate-priority' }),
    )
  })

  it('blocks when the body file is empty or whitespace-only', async () => {
    const manifest = makeManifest([makeEntry()])
    const { runGh } = makeRunGh({})
    const report = await executePreflight(
      manifest,
      makeDeps({ runGh, readBody: async () => '   \n' }),
    )

    expect(report.entries[0]!.blocked).toContainEqual(
      expect.objectContaining({ code: 'body-unreadable' }),
    )
  })
})

describe('executePreflight saturated search and custom policy', () => {
  it('blocks when the duplicate search hit its fetch limit', async () => {
    const hits = Array.from({ length: 20 }, (_, index) => ({
      number: index + 1,
      title: `Other ${index}`,
      url: `https://example.com/${index + 1}`,
    }))
    const manifest = makeManifest([
      makeEntry({
        duplicateSearch: {
          query: 'Fix the thing',
          acknowledgedHits: hits.map((hit) => hit.number),
          acknowledgedSiblings: [],
        },
      }),
    ])
    const { runGh } = makeRunGh({ duplicatesByTitle: { 'Fix the thing': hits } })
    const report = await executePreflight(manifest, makeDeps({ runGh }))

    expect(report.entries[0]!.blocked).toEqual([
      expect.objectContaining({ code: 'duplicate-search-saturated' }),
    ])
  })

  it('uses a caller-supplied priority and dependencies label policy', async () => {
    const manifest = makeManifest([makeEntry({ priority: 'P1', dependencies: ['e0'] })])
    const { runGh } = makeRunGh({ labels: ['P0', 'P1', 'blocked-by'] })
    const policy = { priorityLabels: ['P0', 'P1'], dependenciesLabel: 'blocked-by' }
    const report = await executePreflight(manifest, makeDeps({ runGh, policy }))

    expect(report.entries[0]).toMatchObject({
      status: 'pass',
      resolvedLabels: ['P1', 'blocked-by'],
    })
  })
})
