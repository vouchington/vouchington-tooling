import { describe, expect, it } from 'vitest'
import { composeRetrospective, type JournalLoader } from './index.mts'
import type { RetrospectiveCompositionInput } from './feedback-compose.mts'

const ci = (name: string) =>
  [
    `- \`one-off\` — \`GitHub Actions\` — ${name}`,
    '  - Evidence: run 42 on abc1234',
    '  - Root diagnostic: runner starvation',
    '  - Disposition: reran, passed',
  ].join('\n')
const escalation = (command: string) =>
  [
    `- \`sandbox-escalation\` — ${command} — network write blocked`,
    '  - Outcome: approved',
    '  - Evidence: permission prompt shown',
    '  - Disposition: none',
  ].join('\n')

const loaderOf =
  (...markdown: string[]): JournalLoader =>
  () => ({
    status: 'ok',
    entries: markdown.map((value) => ({ data: { type: 'journal', markdown: value } })),
  })

const base = (journalLoader: JournalLoader): RetrospectiveCompositionInput => ({
  sessionId: 'native:owner',
  date: '2026-01-01',
  issues: [],
  prs: [],
  description: 'Journal only audit',
  repositories: ['owner/repo'],
  workOutcome: 'success',
  feedbackCoverage: { status: 'partial', sources: ['journal'], droppedCount: 0 },
  narrative: 'Narrative.',
  facts: { status: 'unavailable', reason: 'not assessed here' },
  transcript: { status: 'not-assessed', reason: 'no transcript selected' },
  journal: { journalLoader },
  tools: { status: 'none-observed', reason: 'inspected tool results' },
  architecture: { status: 'none-observed', reason: 'inspected changed service' },
})

describe('journal-only audit sections', () => {
  it('lists CI failures and escalations from journal entries with no hook checkpoints', async () => {
    const markdown = await composeRetrospective(
      base(loaderOf(ci('lint job timed out'), escalation('git push'))),
    )
    expect(markdown).toContain('## CI Failures\nStatus: failures observed')
    expect(markdown).toContain('lint job timed out')
    expect(markdown).toContain('Status: events observed (journal entries only)')
    expect(markdown).toContain('`sandbox-escalation` — git push')
  })

  it('reads every block of an entry that holds several', async () => {
    const markdown = await composeRetrospective(
      base(
        loaderOf(
          `${ci('first failure')}\n\n${ci('second failure')}`,
          `${escalation('git push')}\n${escalation('pnpm install')}\n`,
        ),
      ),
    )
    for (const text of ['first failure', 'second failure', 'git push', 'pnpm install'])
      expect(markdown).toContain(text)
    expect(markdown).not.toContain('did not match the block grammar')
  })

  it('reports blocks that name an audit type but do not match, instead of none observed', async () => {
    const markdown = await composeRetrospective(
      base(
        loaderOf(
          '- `one-off` — `GitHub Actions` — typecheck failed (no detail fields)',
          'CI failed twice: `recurring` — `GitHub Actions` — flaky test',
          `${escalation('git push')}\n- \`sandbox-failure\` — node test — EPERM`,
          'plain note with no audit block',
        ),
      ),
    )
    expect(markdown).toContain('Status: failures observed')
    expect(markdown).toContain('2 journal blocks named a CI failure but did not match')
    expect(markdown).toContain('1 journal blocks named a sandbox event but did not match')
    expect(markdown).toContain('`sandbox-escalation` — git push')
    expect(markdown).not.toMatch(
      /## (?:CI Failures|Sandbox & Permission Audit)\nStatus: none observed/,
    )
  })
})
