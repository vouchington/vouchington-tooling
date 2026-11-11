import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../audit-journal/types.mts'
import { scopeSinceRetrospective } from '../audit-journal/scope.mts'
import { buildJournalAuditReport } from './feedback-journal-audit.mts'

const ci = (name: string) =>
  [
    `- \`recurring\` — \`GitHub Actions\` — ${name}`,
    '  - Evidence: CI run 1 failed',
    '  - Root diagnostic: cache',
    '  - Disposition: rerun',
  ].join('\n')
const sandbox = (name: string) =>
  [
    `- \`sandbox-failure\` — ${name} — EPERM`,
    '  - Evidence: stderr showed EPERM',
    '  - Disposition: moved output',
  ].join('\n')

const at = (day: number) => `2026-01-0${day}T00:00:00.000Z`
const journal = (day: number, markdown: string): JournalEntry => ({
  createdAt: at(day),
  data: { type: 'journal', markdown },
})
const retro = (sourceEventId: string, day: number) => ({ sourceEventId, createdAt: at(day) })

const report = (entries: JournalEntry[]) =>
  buildJournalAuditReport('native:owner', {
    journalLoader: () => ({ status: 'ok', entries }),
  }).then((result) => result.markdown)

// The loader hands back raw entries; retrospectives arrive as entries of their own.
const withRetros = (entries: JournalEntry[], retros: ReturnType<typeof retro>[]) => [
  ...entries,
  ...retros.map(({ sourceEventId, createdAt }) => ({
    createdAt,
    data: { type: 'retrospective', sourceEventId },
  })),
]

describe('retrospective scope', () => {
  const before = [journal(1, ci('old ci')), journal(2, sandbox('old node'))]
  const after = [journal(4, ci('new ci')), journal(5, sandbox('new node'))]

  it('composes only blocks after the saved retrospective and reports the excluded count', async () => {
    const markdown = await report(withRetros([...before, ...after], [retro('r1', 3)]))
    expect(markdown).toContain('new ci')
    expect(markdown).toContain('new node')
    expect(markdown).not.toContain('old ci')
    expect(markdown).not.toContain('old node')
    expect(markdown).toContain(
      '## CI Failures\nStatus: failures observed\nExcluded: 1 blocks from before retrospective r1',
    )
    expect(markdown).toContain(
      'Status: events observed (journal entries only)\nExcluded: 1 blocks from before retrospective r1',
    )
  })

  it('reports the exclusion on an empty section and on an incomplete scan', async () => {
    const markdown = await report(withRetros([...before, journal(4, 'a free-form note')], []))
    expect(markdown).not.toContain('Excluded')
    const empty = await report(
      withRetros([...before, journal(4, 'x'), journal(5, ci('c'))], [retro('r1', 3)]),
    )
    expect(empty).toContain('Status: none observed (journal entries only)\nExcluded: 1 blocks')
    const partial = await buildJournalAuditReport('native:owner', {
      journalLoader: () => ({
        status: 'ok',
        entries: [
          ...withRetros([...before, ...after], [retro('r1', 3)]),
          journal(6, 'x'.repeat(10_001)),
        ],
      }),
    })
    expect(partial.coverage.journalStatus).toBe('partial')
    expect(partial.markdown).toContain(
      'Status: unavailable (journal scan incomplete)\nExcluded: 1 blocks from before retrospective r1',
    )
  })

  it('keeps the blocks of the latest retrospective when it is revised', async () => {
    // r1 at day 3 covered `before`; r2 at day 6 covered `after`. Revising r2 has no block after it.
    const markdown = await report(
      withRetros([...before, ...after], [retro('r1', 3), retro('r2', 6)]),
    )
    expect(markdown).toContain('new ci')
    expect(markdown).toContain('new node')
    expect(markdown).not.toContain('old ci')
    expect(markdown).toContain('Excluded: 1 blocks from before retrospective r1')
  })

  it('leaves a session with no earlier retrospective unchanged', async () => {
    const markdown = await report([...before, ...after])
    expect(markdown).toContain('old ci')
    expect(markdown).toContain('new ci')
    expect(markdown).not.toContain('Excluded')
  })
})

describe('scopeSinceRetrospective', () => {
  const blocks = [journal(1, ci('a')), journal(4, ci('b'))]

  it('excludes nothing without a block or a retrospective older than the newest block', () => {
    expect(scopeSinceRetrospective([journal(1, 'note')], [retro('r', 0)]).boundary).toBeUndefined()
    expect(scopeSinceRetrospective(blocks, [retro('r', 5)]).boundary).toBeUndefined()
    expect(scopeSinceRetrospective(blocks, []).excluded).toEqual([])
  })

  it('ignores free-form entries and entries without a usable time when choosing the boundary', () => {
    const untimed = { data: { type: 'journal', markdown: ci('untimed') } } as JournalEntry
    const note = journal(6, 'later free-form note')
    const scope = scopeSinceRetrospective([...blocks, untimed, note], [retro('r', 3)])
    expect(scope.boundary?.sourceEventId).toBe('r')
    // The untimed entry cannot be shown older, so it stays; the earlier block goes.
    expect(scope.included).toEqual([blocks[1], untimed, note])
    expect(scope.excluded).toEqual([blocks[0]])
  })

  it('picks the newest of several earlier retrospectives', () => {
    const scope = scopeSinceRetrospective(blocks, [retro('old', 2), retro('mid', 3), retro('x', 0)])
    expect(scope.boundary?.sourceEventId).toBe('mid')
    expect(
      scopeSinceRetrospective([{ data: { type: 'journal' } }], [retro('r', 3)]).excluded,
    ).toEqual([])
  })
})
