import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { recordFriction } from '../session-friction/index.mts'
import {
  composeRetrospective,
  type JournalEntry,
  type RetrospectiveCompositionInput,
} from './index.mts'

const TOKEN = `ghp_${'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jL5'}`
const SECRET = 'zz-secret_key-9'
const CALLER_ONLY = 'acme-internal_cred-42'
const GRAMMAR = [
  /^- `(recurring|one-off)` — `(.+?)` — .*[^\s]$/,
  /^ {2}- Evidence: .*[^\s]$/,
  /^ {2}- Root diagnostic: .*[^\s]$/,
  /^ {2}- Disposition: .*[^\s]$/,
]
const directories: string[] = []
afterAll(() => Promise.all(directories.map((value) => rm(value, { recursive: true, force: true }))))

type Overrides = Partial<RetrospectiveCompositionInput> & {
  redact?: (value: string) => string
  budgets?: { ciBytes: number; sandboxBytes: number }
}
const entries = (...markdown: string[]): JournalEntry[] =>
  markdown.map((value) => ({ data: { type: 'journal', markdown: value } }))
const compose = (markdown: string[], overrides: Overrides = {}): Promise<string> => {
  const { redact, budgets, ...rest } = overrides
  return composeRetrospective({
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
    ...(rest.friction
      ? {}
      : {
          journal: {
            journalLoader: () => ({ status: 'ok', entries: entries(...markdown) }),
            ...(redact ? { redact } : {}),
            ...(budgets ? { budgets } : {}),
          },
        }),
    knownSensitiveValues: [SECRET],
    ...rest,
  })
}
const url = (n: number): string =>
  `https://github.com/acme/app/actions/runs/${1000 + n}/job/${9000 + n}`
const sha = (n: number): string =>
  `${n.toString(16).padStart(2, '0')}${'cafe1234'.repeat(5)}`.slice(0, 40)
const ciBlock = (n: number, padding = 300): string =>
  [
    `- \`one-off\` — \`GitHub Actions\` — job ${n} timeout in merge ${'queue '.repeat(30)}end`,
    `  - Evidence: ${url(n)} at commit ${sha(n)} no-mistakes impact: none ${'trace '.repeat(padding)}end`,
    `  - Root diagnostic: ${'runner starved '.repeat(padding)}end`,
    `  - Disposition: reran ${'again '.repeat(padding / 3)}end`,
  ].join('\n')
const section = (markdown: string, title: string): string[] => {
  const start = markdown.indexOf(`## ${title}\n`)
  const end = markdown.indexOf('\n## ', start + 1)
  return markdown.slice(start, end === -1 ? undefined : end).split('\n')
}
/** Every group in the CI section, as four grammar-valid lines. */
const ciGroups = (markdown: string): string[][] => {
  const body = section(markdown, 'CI Failures').slice(3).join('\n').split('\n\n')
  return body.filter(Boolean).map((group) => group.trim().split('\n'))
}
const expectLimits = (markdown: string): void => {
  expect(Buffer.byteLength(markdown)).toBeLessThanOrEqual(12_000)
  for (const line of markdown.split('\n')) expect(line).toBe(line.trimEnd())
}

describe('audit redaction', () => {
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
})

describe('audit size fitting', () => {
  it('keeps a realistic long block whole when there is room', async () => {
    const block = [
      `- \`one-off\` — \`GitHub Actions\` — ${'job timeout in merge queue '.repeat(5)}done`,
      `  - Evidence: ${url(1)} at commit ${sha(1)}; no-mistakes impact: none`,
      '  - Root diagnostic: runner lost connection',
      '  - Disposition: rerun',
    ].join('\n')
    const markdown = await compose([block])
    const [group] = ciGroups(markdown)
    expect(ciGroups(markdown)).toHaveLength(1)
    expect(group![1]).toContain(`${url(1)} at commit ${sha(1)}; no\\-mistakes impact: none`)
    expect(markdown).not.toContain('omitted')
    expect(markdown).not.toContain('…')
  })

  it('reports omitted groups and keeps valid, intact groups when 20 large blocks overflow', async () => {
    const markdown = await compose(
      Array.from({ length: 20 }, (_, index) => ciBlock(index)),
      { narrative: 'n'.repeat(7_500) },
    )
    expectLimits(markdown)
    expect(section(markdown, 'CI Failures')[1]).toBe('Status: failures observed')
    const groups = ciGroups(markdown)
    const omission = groups.find((group) => group[0]!.includes('omitted to fit the size limit'))!
    const omitted = Number(/(\d+) further failure groups omitted/.exec(omission[0]!)![1])
    const rendered = groups.filter((group) => group !== omission)
    expect(rendered.length).toBeGreaterThanOrEqual(1)
    expect(rendered.length + omitted).toBe(20)
    for (const group of groups) {
      expect(group).toHaveLength(4)
      group.forEach((line, index) => expect(line).toMatch(GRAMMAR[index]!))
    }
    // Root diagnostic is cut before Evidence, and cuts never split a URL or SHA.
    for (const [index, group] of rendered.entries()) {
      expect(group[1]).toContain(`${url(index)} at commit ${sha(index)} no\\-mistakes impact: none`)
    }
    const found = markdown.match(/https:\/\/\S+/g)!
    for (const link of found) expect(Array.from({ length: 20 }, (_, n) => url(n))).toContain(link)
    for (const hash of markdown.match(/\b[0-9a-f]{40}\b/g)!)
      expect(Array.from({ length: 20 }, (_, n) => sha(n))).toContain(hash)
  })

  it('reports omitted sandbox events when 100 long events overflow', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'feedback-fit-events-'))
    directories.push(directory)
    for (let index = 0; index < 100; index++)
      recordFriction(
        'native:owner',
        {
          type: 'tool-result',
          command: `git push origin branch-${index}`,
          permissionOutcome: 'approved',
          escalationDetail: `network write ${index} blocked ${'because proxy denied '.repeat(45)}`,
        },
        { directory },
      )
    const markdown = await compose([], {
      friction: { directory, journalLoader: () => ({ status: 'not-found' }) },
      narrative: 'n'.repeat(5_000),
    })
    expectLimits(markdown)
    const lines = section(markdown, 'Sandbox & Permission Audit')
    expect(lines[1]).toBe('Events observed: 100')
    const count = Number(/- omitted \((\d+)\)/.exec(lines.join('\n'))![1])
    const events = lines.filter((line) => line.startsWith('  - git push'))
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events.length + count).toBe(100)
    expect(lines.join('\n')).toContain(`  - see journal — ${count} events omitted`)
  })

  it('fits 25 issue and 25 PR references plus several long CI blocks', async () => {
    const reference = (kind: string, index: number): string =>
      `https://example.com/${kind}/${index}/${'x'.repeat(100)}`.slice(0, 130)
    const markdown = await compose(
      Array.from({ length: 4 }, (_, index) => ciBlock(index)),
      {
        issues: Array.from({ length: 25 }, (_, index) => reference('issues', index)),
        prs: Array.from({ length: 25 }, (_, index) => reference('pulls', index)),
      },
    )
    expectLimits(markdown)
    const groups = ciGroups(markdown)
    expect(groups.length).toBeGreaterThanOrEqual(1)
    for (const group of groups)
      group.forEach((line, index) => expect(line).toMatch(GRAMMAR[index]!))
  })

  it('bounds a long session id when no journal or friction log exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'feedback-fit-session-'))
    directories.push(directory)
    const markdown = await compose([], {
      sessionId: '-'.repeat(4_000),
      friction: { directory, journalLoader: () => ({ status: 'not-found' }) },
    })
    expectLimits(markdown)
    const status = section(markdown, 'CI Failures')[1]!
    expect(status).toMatch(/^Status: unavailable \(no friction log for session .+…\)$/)
    expect(Buffer.byteLength(status)).toBeLessThan(200)
  })

  it('never exceeds a caller-supplied cap and says what was omitted', async () => {
    const markdown = await compose([ciBlock(1), ciBlock(2), ciBlock(3)], {
      budgets: { ciBytes: 100, sandboxBytes: 3_000 },
    })
    const groups = ciGroups(markdown)
    expect(groups).toHaveLength(1)
    expect(groups[0]![0]).toContain('3 further failure groups omitted')
    expect(markdown).not.toContain(url(1))
  })

  it('fails with the codec limit error when the other sections alone overflow', async () => {
    await expect(compose([ciBlock(1)], { narrative: 'n'.repeat(11_990) })).rejects.toThrow()
  })
})
