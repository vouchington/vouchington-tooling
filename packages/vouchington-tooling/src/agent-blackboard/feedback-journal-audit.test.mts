import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../session-friction/types.mts'
import { buildJournalAuditReport } from './feedback-journal-audit.mts'
import { getConformingSandboxBlocks } from './feedback-journal-sandbox.mts'

const ciFailure = [
  '- `recurring` — `GitHub Actions` — build cache failure',
  '  - Evidence: CI run 123 failed twice',
  '  - Root diagnostic: cache corruption',
  '  - Disposition: rebuilt cache',
].join('\n')
const escalation = [
  '- `sandbox-escalation` — git push — network write blocked',
  '  - Outcome: approved',
  '  - Evidence: permission prompt shown',
  '  - Disposition: reran with approval',
].join('\n')
const failure = [
  '- `sandbox-failure` — node test — EPERM writing outside the worktree',
  '  - Evidence: stderr showed EPERM',
  '  - Disposition: moved output under TMPDIR',
].join('\n')
const ambiguous = failure.replace('sandbox-failure', 'ambiguous-failure')
const NONE = 'Status: none observed (journal entries only; no friction log observed)'
const EVENTS = 'Status: events observed (journal entries only; no friction log observed)'

const entry = (markdown: unknown, type = 'journal'): JournalEntry =>
  ({ data: { type, markdown } }) as JournalEntry
const report = (entries: Iterable<JournalEntry> | AsyncIterable<JournalEntry>) =>
  buildJournalAuditReport('native:owner', {
    journalLoader: () => ({ status: 'ok', entries }),
  })

describe('journal-only audit report', () => {
  it('reports an empty journal as observed with no findings', async () => {
    const result = await report([])
    expect(result.coverage).toEqual({
      journalStatus: 'complete',
      frictionStatus: 'journal-only',
      truncated: false,
    })
    expect(result.markdown).toBe(
      `## CI Failures\nStatus: none observed\n\n## Sandbox & Permission Audit\n${NONE}`,
    )
  })

  it('renders CI failures and sandbox or permission entries from the journal', async () => {
    const result = await report([
      entry(ciFailure),
      entry(escalation),
      entry(failure),
      entry(ambiguous),
      entry('free-form note that does not conform'),
      entry(escalation, 'retrospective'),
    ])
    expect(result.coverage.journalStatus).toBe('complete')
    expect(result.markdown).toBe(
      [
        '## CI Failures\nStatus: failures observed',
        ciFailure,
        `## Sandbox & Permission Audit\n${EVENTS}`,
        [escalation, failure, ambiguous].join('\n\n'),
      ].join('\n\n'),
    )
  })

  it('keeps the CI section to the validator-accepted status lines', async () => {
    const withSandboxOnly = await report([entry(escalation)])
    expect(withSandboxOnly.markdown.split('\n\n')[0]).toBe('## CI Failures\nStatus: none observed')
    const withCiOnly = await report([entry(ciFailure)])
    expect(withCiOnly.markdown).toContain(`## Sandbox & Permission Audit\n${NONE}`)
  })

  it('supports an async journal iterable', async () => {
    const result = await report(
      (async function* () {
        yield entry(failure)
      })(),
    )
    expect(result.markdown).toContain(`Sandbox & Permission Audit\n${EVENTS}\n\n${failure}`)
  })

  it('treats a missing journal as unavailable rather than empty', async () => {
    const result = await buildJournalAuditReport('native:owner', {
      journalLoader: () => ({ status: 'not-found' }),
    })
    expect(result.coverage).toEqual({
      journalStatus: 'unavailable',
      frictionStatus: 'journal-only',
      truncated: false,
    })
    expect(result.markdown).toBe(
      '## CI Failures\nStatus: unavailable (no journal for session)\n\n' +
        '## Sandbox & Permission Audit\nStatus: unavailable (no journal for session)',
    )
  })

  it('treats an unreachable journal as unavailable and keeps the diagnostic out', async () => {
    const result = await buildJournalAuditReport('native:owner', {
      journalLoader: async () => {
        throw new Error('token=secret timeout')
      },
    })
    expect(result.coverage.journalStatus).toBe('unavailable')
    expect(result.markdown).toBe(
      '## CI Failures\nStatus: unavailable (blackboard unreachable)\n\n' +
        '## Sandbox & Permission Audit\nStatus: unavailable (blackboard unreachable)',
    )
  })

  it('reports partial coverage while keeping validated blocks when the scan is truncated', async () => {
    const result = await report(
      (function* () {
        yield entry(ciFailure)
        yield entry(escalation)
        while (true) yield entry('noise', 'retrospective')
      })(),
    )
    expect(result.coverage).toEqual({
      journalStatus: 'partial',
      frictionStatus: 'journal-only',
      truncated: false,
    })
    expect(result.markdown).toBe(
      [
        '## CI Failures\nStatus: unavailable (journal scan incomplete)',
        ciFailure,
        '## Sandbox & Permission Audit\nStatus: unavailable (journal scan incomplete)',
        escalation,
      ].join('\n\n'),
    )
  })

  it('skips entries whose data cannot be read and reports the scan as incomplete', async () => {
    const hostile = {
      get data(): never {
        throw new Error('boom')
      },
    } as unknown as JournalEntry
    const result = await report([hostile, entry(failure)])
    expect(result.coverage.journalStatus).toBe('partial')
    expect(result.markdown).toContain(`unavailable (journal scan incomplete)\n\n${failure}`)
  })

  it('validates the session ID before invoking the journal loader', async () => {
    let called = false
    await expect(
      buildJournalAuditReport('', {
        journalLoader: () => {
          called = true
          return { status: 'not-found' }
        },
      }),
    ).rejects.toThrow('sessionId must be non-empty')
    expect(called).toBe(false)
  })
})

describe('sandbox journal grammar', () => {
  it('accepts each block shape with surrounding blank lines and CRLF', () => {
    const blocks = [escalation, failure, ambiguous].map((block) => `\n\n${block}\n`)
    expect(getConformingSandboxBlocks(blocks.map((markdown) => entry(markdown)))).toEqual([
      escalation,
      failure,
      ambiguous,
    ])
    expect(getConformingSandboxBlocks([entry(escalation.replaceAll('\n', '\r\n'))])).toEqual([
      escalation,
    ])
  })

  it('rejects incomplete, extra, reordered, and unknown-outcome blocks', () => {
    const lines = escalation.split('\n')
    for (const markdown of [
      lines.slice(0, 3).join('\n'),
      `${escalation}\nextra`,
      `${escalation}\n${failure}`,
      [lines[0], lines[2], lines[1], lines[3]].join('\n'),
      escalation.replace('approved', 'maybe'),
      failure.replace('sandbox-failure', 'tool-failure'),
      failure.replace('  - Evidence', '- Evidence'),
      '',
    ])
      expect(getConformingSandboxBlocks([entry(markdown)])).toEqual([])
  })

  it('rejects ill-formed Unicode and fields that sanitise to nothing', () => {
    expect(getConformingSandboxBlocks([entry(failure.replace('EPERM', '\uD800'))])).toEqual([])
    expect(getConformingSandboxBlocks([entry(failure.replace('stderr showed EPERM', '​'))])).toEqual(
      [],
    )
  })

  it('escapes Markdown and keeps each field whole before rendering', () => {
    const unsafe = failure
      .replace('EPERM writing outside the worktree', '<!-- hidden')
      .replace('moved output under TMPDIR', '--> *forged* ' + 'x'.repeat(200))
    const [block] = getConformingSandboxBlocks([entry(unsafe)])
    expect(block).toContain('\\<\\!\\-\\- hidden')
    expect(block).not.toMatch(/(?:^|[^\\])<!--/)
    const disposition = block!.split('\n').at(-1)!
    expect(disposition).toMatch(/^ {2}- Disposition: \\-\\-\\> \\\*forged\\\* x+$/)
    expect(disposition.endsWith(`x${'x'.repeat(199)}`)).toBe(true)
  })

  it('ignores null entries', () => {
    expect(getConformingSandboxBlocks([null as unknown as JournalEntry, entry(failure)])).toEqual([
      failure,
    ])
  })
})
