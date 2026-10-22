import { describe, expect, it } from 'vitest'
import { classifyAudit } from './classify.mts'
import { formatMarkdown, formatReport, HEADER } from './report.mts'
import { formatRaw, scopeLine } from './report-raw.mts'
import { emptyScanResult, type ScanResult } from './types.mts'

const nothing = { covers: () => false }
const everything = { covers: () => true }

function populated(): ScanResult {
  return {
    ...emptyScanResult(),
    claudeFilesScanned: 3,
    codexFilesScanned: 1,
    repoRoots: ['/repo', '/wt1', '/wt2'],
    readErrors: ['/secret/path.jsonl: boom'],
    skippedOtherRepo: { claude: 2, codex: 1 },
    skippedUnknownCwd: { claude: 1, codex: 0 },
    claudeEscalations: [{ source: 'claude', command: 'pnpm install --token=SECRET' }],
    claudeDenials: [
      { source: 'claude', kind: 'user-rejected', command: 'rm -rf /' },
      { source: 'claude', kind: 'permission-rule' },
      { source: 'claude', kind: 'user-rejected' },
    ],
    claudeSandboxFailures: [
      { source: 'claude', kind: 'genuine', command: 'curl x', errorText: 'denied' },
      { source: 'claude', kind: 'write-path', errorText: 'ro' },
    ],
    codexSandboxFailures: [
      { source: 'codex', kind: 'write-path', command: 'git fetch', errorText: 'ro' },
    ],
  }
}

describe('scopeLine', () => {
  it('names the root, extra worktrees and everything skipped', () => {
    expect(scopeLine(populated())).toBe(
      'Scope: /repo (+2 worktrees) — 3 Claude / 1 Codex files scanned; 3 skipped (other repo), 1 skipped (cwd unknown)',
    )
  })

  it('handles a single worktree, no skips and no root', () => {
    const base = { ...emptyScanResult(), repoRoots: ['/repo', '/wt'] }
    expect(scopeLine(base)).toBe('Scope: /repo (+1 worktree) — 0 Claude / 0 Codex files scanned')
    expect(scopeLine(emptyScanResult())).toContain('(no repo root resolved)')
  })
})

describe('formatMarkdown', () => {
  it('shows prefixes and counts only', () => {
    const scan = populated()
    const text = formatMarkdown(classifyAudit(scan, nothing))
    expect(text.startsWith(`${HEADER}\nScope: /repo`)).toBe(true)
    expect(text).toContain('  - curl x (1)')
    expect(text).toContain('  - rm -rf (1)')
    expect(text).toContain('(+1 with an unresolved command')
    expect(text).toContain('## Denial hygiene (block policy already working as intended): 1')
    expect(text).toContain('## Other classified sandbox failures (not allow-list candidates): 2')
    expect(text).toContain('  - write-path (2)')
    expect(text).toContain('Read errors: 1 (rerun with --raw to inspect)')
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('/secret/path')
  })

  it('marks what the policy already handles', () => {
    const text = formatMarkdown(classifyAudit(populated(), everything))
    expect(text).toContain('  - curl x (1) [already allowed]')
    expect(text).toContain('  - rm -rf (1) [already denied]')
  })

  it('renders an empty scan with placeholders and no optional sections', () => {
    const text = formatMarkdown(classifyAudit(emptyScanResult(), nothing))
    expect(text).toContain('  (none)')
    expect(text).not.toContain('Other classified')
    expect(text).not.toContain('Read errors')
    expect(text).not.toContain('Raw retention')
    expect(
      text.endsWith('Scanned 0 Claude transcript file(s), 0 Codex transcript file(s).\n'),
    ).toBe(true)
  })

  it('reports bounded retention so a capped run never looks complete', () => {
    const scan = emptyScanResult()
    scan.rawRetention.recordsDropped = 4
    scan.rawRetention.rawBytesDropped = 99
    expect(formatMarkdown(classifyAudit(scan, nothing))).toContain(
      'Raw retention bounded: 0 command text(s), 0 error text(s), 0 pending tool use(s), 4 record(s) truncated or dropped; 0 pending and 99 raw byte(s) evicted.',
    )
  })
})

describe('formatRaw', () => {
  it('prints full command and failure text behind a warning', () => {
    const text = formatRaw(populated())
    expect(text).toContain('RAW MODE')
    expect(text).toContain('  - pnpm install --token=SECRET')
    expect(text).toContain('  - [permission-rule] (unresolved)')
    expect(text).toContain('  - [genuine] curl x: denied')
    expect(text).toContain('  - [write-path] (unresolved): ro')
    expect(text).toContain('  - [write-path] git fetch: ro')
    expect(text).toContain('  - /secret/path.jsonl: boom')
    expect(text).not.toContain('Raw retention bounded')
  })

  it('warns when retention caps dropped records, as the default report does', () => {
    const scan = emptyScanResult()
    scan.rawRetention.recordsDropped = 1
    expect(formatRaw(scan)).toContain('Raw retention bounded: 0 command text(s)')
  })
})

describe('formatReport', () => {
  const scan = populated()
  const audit = classifyAudit(scan, nothing)

  it('chooses markdown, raw or JSON', () => {
    expect(formatReport(scan, audit)).toBe(formatMarkdown(audit))
    expect(formatReport(scan, audit, { raw: true })).toBe(formatRaw(scan))
    expect(JSON.parse(formatReport(scan, audit, { json: true }))).toEqual(
      JSON.parse(JSON.stringify(audit)),
    )
    expect(
      JSON.parse(formatReport(scan, audit, { json: true, raw: true })).claudeEscalations,
    ).toHaveLength(1)
  })

  it('keeps private text out of the default JSON', () => {
    expect(formatReport(scan, audit, { json: true })).not.toContain('SECRET')
  })
})
