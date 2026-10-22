import { describe, expect, it } from 'vitest'
import { classifyAudit } from './classify.mts'
import {
  coverageByPrefix,
  groupByPrefix,
  splitByCoverage,
  toSortedPrefixCounts,
  unresolvedCount,
  type CoverageList,
  type CoveragePolicy,
} from './classify-prefixes.mts'
import { emptyScanResult, type ScanResult } from './types.mts'

function policy(rules: Partial<Record<CoverageList, string[]>>): CoveragePolicy {
  return {
    covers: (list, commandOrPrefix) =>
      (rules[list] ?? []).some(
        (rule) => commandOrPrefix === rule || commandOrPrefix.startsWith(`${rule} `),
      ),
  }
}

describe('prefix grouping', () => {
  it('normalizes commands, counts unresolved ones, and sorts by count then name', () => {
    const counts = groupByPrefix(['git status', 'git status -s', 'ls', undefined, '', 'ls'])
    expect(toSortedPrefixCounts(counts)).toEqual([
      { prefix: 'git status', count: 2 },
      { prefix: 'ls', count: 2 },
    ])
    expect(unresolvedCount(counts)).toBe(2)
    expect(unresolvedCount(groupByPrefix(['ls']))).toBe(0)
  })

  it('treats a group as covered only when every raw command in it is', () => {
    const deny = policy({ deny: ['rm -rf /'] })
    const coverage = coverageByPrefix(['rm -rf /', 'rm -rf /tmp', 'ls', undefined], 'deny', deny)
    expect(coverage.get('rm -rf')).toBe(false)
    expect(coverage.get('ls')).toBe(false)
    expect(coverageByPrefix(['rm -rf /'], 'deny', deny).get('rm -rf')).toBe(true)
  })

  it('splits prefixes into covered and uncovered, leaving unresolved ones out', () => {
    const counts = groupByPrefix(['pnpm test', 'pnpm test', 'curl x', undefined])
    expect(splitByCoverage(counts, 'excluded', policy({ excluded: ['pnpm test'] }))).toEqual({
      covered: [{ prefix: 'pnpm test', count: 2 }],
      uncovered: [{ prefix: 'curl x', count: 1 }],
      unresolvedCount: 1,
    })
  })
})

function scan(): ScanResult {
  return {
    ...emptyScanResult(),
    claudeFilesScanned: 2,
    codexFilesScanned: 1,
    readErrors: ['a', 'b'],
    repoRoots: ['/repo'],
    claudeEscalations: [
      { source: 'claude', command: 'pnpm test' },
      { source: 'claude', command: 'curl x' },
    ],
    claudeDenials: [
      { source: 'claude', kind: 'user-rejected', command: 'rm -rf /' },
      { source: 'claude', kind: 'user-rejected', command: 'git push' },
      { source: 'claude', kind: 'user-rejected' },
      { source: 'claude', kind: 'permission-rule', command: 'x' },
      { source: 'claude', kind: 'automode-blocked', command: 'y' },
    ],
    claudeSandboxFailures: [
      { source: 'claude', kind: 'genuine', command: 'gh pr view', errorText: 'e' },
      { source: 'claude', kind: 'genuine', command: 'curl x', errorText: 'e' },
      { source: 'claude', kind: 'genuine', errorText: 'e' },
      { source: 'claude', kind: 'e2big', command: 'big', errorText: 'e' },
      { source: 'claude', kind: 'write-path', command: 'git fetch', errorText: 'e' },
    ],
    codexSandboxFailures: [
      { source: 'codex', kind: 'write-path', command: 'git fetch', errorText: 'e' },
      { source: 'codex', kind: 'another', errorText: 'e' },
    ],
  }
}

describe('classifyAudit', () => {
  const audit = classifyAudit(
    scan(),
    policy({ allow: ['gh pr'], deny: ['rm -rf /'], excluded: ['pnpm test'] }),
  )

  it('buckets bypass candidates against the allow list', () => {
    expect(audit.genuineBypassCandidates).toEqual([
      { prefix: 'curl x', count: 1, alreadyInAllowList: false },
      { prefix: 'gh pr', count: 1, alreadyInAllowList: true },
    ])
    expect(audit.genuineBypassUnresolvedCount).toBe(1)
  })

  it('buckets human rejections against the deny list', () => {
    expect(audit.blockCandidates).toEqual([
      { prefix: 'git push', count: 1, alreadyDenied: false },
      { prefix: 'rm -rf', count: 1, alreadyDenied: true },
    ])
    expect(audit.blockCandidateUnresolvedCount).toBe(1)
    expect(audit.policyBlockCount).toBe(2)
  })

  it('splits escalation pressure by the excluded list and counts E2BIG', () => {
    expect(audit.escalationPressure).toEqual({
      claudeCovered: [{ prefix: 'pnpm test', count: 1 }],
      claudeUncovered: [{ prefix: 'curl x', count: 1 }],
      claudeUnresolvedCount: 0,
      e2bigCount: 1,
    })
  })

  it('counts caller-defined kinds separately and never as bypass candidates', () => {
    expect(audit.otherFailures).toEqual([
      { kind: 'write-path', count: 2 },
      { kind: 'another', count: 1 },
    ])
  })

  it('carries scope and counts, but only the number of read errors', () => {
    expect(audit).toMatchObject({
      claudeFilesScanned: 2,
      codexFilesScanned: 1,
      readErrorCount: 2,
      repoRoots: ['/repo'],
    })
    expect(JSON.stringify(audit)).not.toContain('"a"')
  })

  it('counts a Codex failure under its kind even when the kind is a built-in one', () => {
    const codex = {
      ...emptyScanResult(),
      codexSandboxFailures: [{ source: 'codex' as const, kind: 'genuine', errorText: '' }],
    }
    expect(classifyAudit(codex, policy({})).otherFailures).toEqual([{ kind: 'genuine', count: 1 }])
  })

  it('orders equally common kinds by name', () => {
    const tied = {
      ...emptyScanResult(),
      codexSandboxFailures: [
        { source: 'codex' as const, kind: 'b', errorText: '' },
        { source: 'codex' as const, kind: 'a', errorText: '' },
      ],
    }
    expect(classifyAudit(tied, policy({})).otherFailures.map((entry) => entry.kind)).toEqual([
      'a',
      'b',
    ])
  })

  it('classifies an empty scan', () => {
    const empty = classifyAudit(emptyScanResult(), policy({}))
    expect(empty.genuineBypassCandidates).toEqual([])
    expect(empty.otherFailures).toEqual([])
  })
})
