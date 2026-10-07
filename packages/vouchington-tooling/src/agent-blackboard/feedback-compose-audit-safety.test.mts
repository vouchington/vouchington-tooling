import { describe, expect, it } from 'vitest'
import {
  composeRetrospective,
  type JournalEntry,
  type RetrospectiveCompositionInput,
} from './index.mts'

const TOKEN = `ghp_${'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jL5'}`
const SECRET = 'zz-secret_key-9'
const FAILURE_GROUP_HEADER = /^- `(recurring|one-off)` — `(.+?)` — .*[^\s]$/

const entries = (...markdown: string[]): JournalEntry[] =>
  markdown.map((value) => ({ data: { type: 'journal', markdown: value } }))
const compose = (markdown: string[], knownSensitiveValues: string[] = [SECRET]): Promise<string> =>
  composeRetrospective({
    sessionId: 'native:owner',
    date: '2026-01-01',
    issues: [1],
    prs: [],
    description: 'Completed bounded task',
    repositories: ['owner/repo'],
    workOutcome: 'success',
    feedbackCoverage: { status: 'partial', sources: ['journal'], droppedCount: 0 },
    narrative: 'Useful resolved finding retained.',
    facts: { status: 'unavailable', reason: 'repository not assessed' },
    transcript: { status: 'not-assessed', reason: 'no transcript selected' },
    tools: { status: 'none-observed', reason: 'inspected tool results' },
    architecture: { status: 'none-observed', reason: 'inspected changed service' },
    journal: { journalLoader: () => ({ status: 'ok', entries: entries(...markdown) }) },
    knownSensitiveValues,
  } satisfies RetrospectiveCompositionInput)

describe('audit redaction and size budget', () => {
  it('redacts tokens and known values from raw text before Markdown escaping', async () => {
    const ci = [
      '- `one-off` — `GitHub Actions` — deploy failed',
      `  - Evidence: token ${TOKEN} and ${SECRET} leaked`,
      '  - Root diagnostic: bad credential',
      '  - Disposition: rotated',
    ].join('\n')
    const sandbox = [
      `- \`sandbox-failure\` — git push ${SECRET} — denied`,
      `  - Evidence: ${TOKEN}`,
      `  - Disposition: used ${SECRET}`,
    ].join('\n')
    const markdown = await compose([ci, sandbox])
    expect(markdown).toContain('\\[REDACTED\\]')
    for (const leaked of [TOKEN, TOKEN.slice(4), SECRET, 'zz\\-secret\\_key\\-9', 'ghp\\_'])
      expect(markdown).not.toContain(leaked)
  })

  it('keeps a block full of escapable characters within the codec limit', async () => {
    const stars = (length: number): string => '*'.repeat(length)
    const ci = [
      `- \`one-off\` — \`GitHub Actions\` — header ${stars(3000)}`,
      `  - Evidence: ${stars(3000)}`,
      `  - Root diagnostic: ${stars(3000)}`,
      '  - Disposition: rerun; no-mistakes impact: none',
    ].join('\n')
    const markdown = await compose([ci])
    expect(Buffer.byteLength(markdown)).toBeLessThanOrEqual(12_000)
    const lines = markdown.split('\n').filter((line) => /^(- `one-off`|  - )/.test(line))
    expect(lines.length).toBeGreaterThanOrEqual(4)
    for (const line of lines) {
      expect(line).toBe(line.trimEnd())
      expect(line.replaceAll(/\\./g, '')).not.toContain('\\')
    }
    expect(lines.find((line) => line.startsWith('- `one-off`'))).toMatch(FAILURE_GROUP_HEADER)
    expect(markdown).toContain('…')
    // The short field is never sacrificed to the long ones.
    expect(markdown).toContain('  - Disposition: rerun; no\\-mistakes impact: none')
  })
})
