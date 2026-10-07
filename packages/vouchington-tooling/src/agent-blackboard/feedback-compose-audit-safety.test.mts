import { describe, expect, it } from 'vitest'
import {
  composeRetrospective,
  type JournalEntry,
  type RetrospectiveCompositionInput,
} from './index.mts'

const TOKEN = `ghp_${'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jL5'}`
const SECRET = 'zz-secret_key-9'
const CALLER_ONLY = 'acme-internal_cred-42'
const FAILURE_GROUP_HEADER = /^- `(recurring|one-off)` — `(.+?)` — .*[^\s]$/

const entries = (...markdown: string[]): JournalEntry[] =>
  markdown.map((value) => ({ data: { type: 'journal', markdown: value } }))
const compose = (
  markdown: string[],
  options: { narrative?: string; redact?: (value: string) => string } = {},
): Promise<string> =>
  composeRetrospective({
    sessionId: 'native:owner',
    date: '2026-01-01',
    issues: [1],
    prs: [],
    description: 'Completed bounded task',
    repositories: ['owner/repo'],
    workOutcome: 'success',
    feedbackCoverage: { status: 'partial', sources: ['journal'], droppedCount: 0 },
    narrative: options.narrative ?? 'Useful resolved finding retained.',
    facts: { status: 'unavailable', reason: 'repository not assessed' },
    transcript: { status: 'not-assessed', reason: 'no transcript selected' },
    tools: { status: 'none-observed', reason: 'inspected tool results' },
    architecture: { status: 'none-observed', reason: 'inspected changed service' },
    journal: {
      journalLoader: () => ({ status: 'ok', entries: entries(...markdown) }),
      ...(options.redact ? { redact: options.redact } : {}),
    },
    knownSensitiveValues: [SECRET],
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

  it('keeps a caller-supplied redactor and applies the built-in one as well', async () => {
    const ci = [
      '- `one-off` — `GitHub Actions` — deploy failed',
      `  - Evidence: ${CALLER_ONLY} and ${SECRET}`,
      '  - Root diagnostic: bad credential',
      '  - Disposition: rotated',
    ].join('\n')
    const markdown = await compose([ci], {
      redact: (value) => value.replaceAll(CALLER_ONLY, '<caller-removed>'),
    })
    expect(markdown).not.toContain(CALLER_ONLY)
    expect(markdown).not.toContain(SECRET)
    expect(markdown).toContain('\\<caller\\-removed\\>')
    expect(markdown).toContain('\\[REDACTED\\]')
  })

  it('fits the audit blocks into the room left by a large narrative', async () => {
    const stars = (length: number): string => '*'.repeat(length)
    const ci = [
      `- \`one-off\` — \`GitHub Actions\` — header ${stars(2000)}`,
      `  - Evidence: ${stars(3000)}`,
      `  - Root diagnostic: ${stars(2000)}`,
      `  - Disposition: ${stars(2000)}`,
    ].join('\n')
    const markdown = await compose([ci], { narrative: 'n'.repeat(7_500) })
    expect(Buffer.byteLength(markdown)).toBeLessThanOrEqual(12_000)
    expect(Buffer.byteLength(JSON.stringify(markdown))).toBeLessThanOrEqual(16_384)
    const header = markdown.split('\n').find((line) => line.startsWith('- `one-off`'))
    expect(header).toMatch(FAILURE_GROUP_HEADER)
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
