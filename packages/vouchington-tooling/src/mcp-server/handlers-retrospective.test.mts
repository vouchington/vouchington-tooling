import { createHash } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BLACKBOARD_ENV } from './fake-blackboard.test-helpers.mts'
import { defaultSourceEventId } from './handlers-retrospective.mts'
import {
  JOURNAL_ARGS,
  harness,
  jsonOf,
  outboxPath,
  textOf,
  useFixedClock,
  useRepoFixture,
} from './harness.test-helpers.mts'
import type { PolicyOutcome, PolicyRequest } from './policy-spawn.mts'

const fixture = useRepoFixture()
const clock = useFixedClock()

const FRONT = [
  '---',
  'date: "2026-01-01"',
  'issues: [12, "owner/repo#3"]',
  'prs: [5]',
  'session_id: "native:owner"',
  'description: "Did a thing"',
  'work_outcome: "success"',
  'feedback_coverage: {"status":"complete","sources":["tool-result"],"droppedCount":0}',
  '---',
  '',
  'Body of the retrospective.',
].join('\n')

const { markdown: _markdown, sourceEventId: _sourceEventId, ...BASE } = JOURNAL_ARGS
const SAVE = { ...BASE, markdown: FRONT }

function declarePolicy(): void {
  writeFileSync(
    join(fixture().main, 'package.json'),
    JSON.stringify({ 'vouchington-tooling': { policy: 'policy.mts' } }),
  )
  writeFileSync(join(fixture().main, 'policy.mts'), '')
}

type Reply = (name: string, input: Record<string, unknown>) => unknown
function policy(reply: Reply) {
  const requests: Array<{ name: string; input: Record<string, unknown>; request: PolicyRequest }> =
    []
  const spawnPolicy = async (request: PolicyRequest): Promise<PolicyOutcome> => {
    const { export: name, input } = JSON.parse(request.input) as {
      export: string
      input: Record<string, unknown>
    }
    requests.push({ name, input, request })
    const result = reply(name, input)
    const stdout = result === undefined ? { ok: true, skipped: true } : { ok: true, result }
    return {
      exitCode: 0,
      stdout: JSON.stringify(stdout),
      stderr: '',
      timedOut: false,
      overflowed: false,
    }
  }
  return { requests, spawnPolicy }
}
const accept: Reply = (name) => (name === 'validateRetrospective' ? { errors: [] } : undefined)

describe('retrospective_save with markdown', () => {
  it('validates through the policy with metadata, then writes a retrospective envelope', async () => {
    declarePolicy()
    const p = policy((name) =>
      name === 'validateRetrospective' ? { errors: [], warnings: ['soft'] } : undefined,
    )
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy })
    const result = await h.call('retrospective_save', {
      ...SAVE,
      repositories: ['Owner/Repo', 'owner/repo'],
    })
    expect(result.isError).toBeUndefined()
    const body = jsonOf(result)
    expect(body).toMatchObject({
      status: 'delivered',
      pendingCount: 0,
      worktreePendingCount: 0,
      policy: { warnings: ['soft'] },
    })
    expect(p.requests).toHaveLength(1)
    expect(p.requests[0]!.input).toEqual({
      sessionId: 'native:owner',
      parentSessionId: null,
      mode: 'autonomous',
      workOutcome: 'success',
      feedbackCoverage: JOURNAL_ARGS.feedbackCoverage,
      repositories: ['owner/repo'],
      markdown: FRONT,
      sourceEventId: 'retrospective-native:owner',
      metadata: {
        date: '2026-01-01',
        issues: [12, 'owner/repo#3'],
        prs: [5],
        description: 'Did a thing',
      },
    })
    expect(h.fake.stored).toHaveLength(1)
    expect(h.fake.stored[0]!.data).toMatchObject({
      type: 'retrospective',
      sourceEventId: 'retrospective-native:owner',
      date: '2026-01-01',
      repositories: ['owner/repo'],
    })
  })

  it('stores the optional category when given', async () => {
    const h = harness(fixture())
    await h.call('retrospective_save', { ...SAVE, category: 'tooling' })
    expect(h.fake.stored[0]!.data).toMatchObject({ type: 'retrospective', category: 'tooling' })
  })

  it('uses an interactive outbox only in interactive mode', async () => {
    declarePolicy()
    const h = harness(fixture(), { spawnPolicy: policy(accept).spawnPolicy })
    await h.call('retrospective_save', { ...SAVE, mode: 'interactive' })
    expect(existsSync(outboxPath(fixture().main))).toBe(true)
  })

  it('returns the stored timestamp, not a new one, for an identical retry', async () => {
    declarePolicy()
    const h = harness(fixture(), { spawnPolicy: policy(accept).spawnPolicy })
    const first = jsonOf(await h.call('retrospective_save', SAVE))
    clock.advance(600_000)
    const second = jsonOf(await h.call('retrospective_save', SAVE))
    expect(second.timestamp).toBe(first.timestamp)
    expect(h.fake.stored).toHaveLength(1)
  })

  it('previews with dryRun and writes nothing', async () => {
    declarePolicy()
    const h = harness(fixture(), { spawnPolicy: policy(accept).spawnPolicy })
    const result = jsonOf(await h.call('retrospective_save', { ...SAVE, dryRun: true }))
    expect(result).toEqual({ markdown: FRONT, policy: { warnings: [] } })
    expect(h.fake.calls.append).toEqual([])
  })

  it('rejects policy errors and writes nothing', async () => {
    declarePolicy()
    const p = policy(() => ({ errors: ['missing outcome section', 'too long'] }))
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy })
    const result = await h.call('retrospective_save', SAVE)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('- missing outcome section\n- too long')
    expect(h.fake.calls.append).toEqual([])
  })

  it('writes without validation when the worktree declares no policy, but needs repositories', async () => {
    const h = harness(fixture())
    expect(jsonOf(await h.call('retrospective_save', SAVE)).status).toBe('delivered')
  })

  it('takes repositories from the front matter, then from pullRequestDefaults, else fails', async () => {
    declarePolicy()
    const { repositories: _ignored, ...noRepositories } = SAVE
    const fromFront = FRONT.replace('---\n\n', 'repositories: ["B/two","a/one"]\n---\n\n')
    const p = policy((name) =>
      name === 'pullRequestDefaults' ? { repositories: ['Z/default'] } : { errors: [] },
    )
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy })
    await h.call('retrospective_save', { ...noRepositories, markdown: fromFront, dryRun: true })
    expect(p.requests.map((r) => r.name)).toEqual(['validateRetrospective'])
    expect(p.requests[0]!.input.repositories).toEqual(['a/one', 'b/two'])
    await h.call('retrospective_save', { ...noRepositories, dryRun: true })
    expect(p.requests.at(-1)!.input.repositories).toEqual(['z/default'])
    const none = harness(fixture(), { spawnPolicy: policy(accept).spawnPolicy })
    const failed = await none.call('retrospective_save', { ...noRepositories, dryRun: true })
    expect(textOf(failed)).toContain('repositories is required')
  })

  it('rejects arguments the front matter contradicts, naming the field', async () => {
    declarePolicy()
    const p = policy(accept)
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy })
    const call = async (args: Record<string, unknown>) =>
      textOf(await h.call('retrospective_save', args))
    expect(await call({ ...SAVE, sessionId: 'native:other' })).toContain(
      'session_id does not match',
    )
    expect(await call({ ...SAVE, workOutcome: 'failure' })).toContain('work_outcome does not match')
    const coverage = { ...SAVE.feedbackCoverage, droppedCount: 2 }
    expect(await call({ ...SAVE, feedbackCoverage: coverage })).toContain(
      'feedback_coverage does not',
    )
    const withRepositories = FRONT.replace('---\n\n', 'repositories: ["a/b"]\n---\n\n')
    expect(await call({ ...SAVE, markdown: withRepositories })).toContain('repositories does not')
    expect(p.requests).toEqual([])
  })

  it('rejects empty, oversized, or malformed markdown before spawning the policy', async () => {
    declarePolicy()
    const p = policy(accept)
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy })
    const call = async (markdown: string) =>
      textOf(await h.call('retrospective_save', { ...SAVE, markdown }))
    expect(await call(' ')).toContain('markdown')
    expect(await call(`${FRONT}\n${'x'.repeat(13_000)}`)).toContain('markdown')
    expect(await call('no front matter')).toContain('front matter')
    expect(p.requests).toEqual([])
  })

  it('rejects a caller timestamp, both or neither markdown source, and a bad dryRun', async () => {
    declarePolicy()
    const h = harness(fixture(), { spawnPolicy: policy(accept).spawnPolicy })
    const call = async (args: Record<string, unknown>) =>
      textOf(await h.call('retrospective_save', args))
    expect(await call({ ...SAVE, timestamp: 'x' })).toContain('unsupported argument(s): timestamp')
    expect(await call({ ...SAVE, compose: {} })).toContain('exactly one of markdown or compose')
    expect(await call(BASE)).toContain('exactly one of markdown or compose')
    expect(await call({ ...SAVE, dryRun: 'yes' })).toContain('dryRun must be a boolean')
  })

  it('refuses policy tools when the server was launched outside a repository', async () => {
    const h = harness(fixture(), { launchRoot: undefined })
    const result = await h.call('retrospective_save', { ...SAVE, worktree: fixture().main })
    expect(textOf(result)).toContain(
      'policy tools require the server to be launched inside a repository worktree',
    )
  })

  it('surfaces a same-event conflict when changed content reuses the sourceEventId', async () => {
    const h = harness(fixture())
    await h.call('retrospective_save', SAVE)
    const edited = await h.call('retrospective_save', { ...SAVE, markdown: `${FRONT}\nMore.` })
    expect(edited.isError).toBe(true)
    expect(textOf(edited)).toContain('event-conflict')
  })
})

describe('retrospective_save with compose', () => {
  const unassessed = { status: 'not-assessed', reason: 'not inspected' }
  const COMPOSE = {
    narrative: 'We did the work.',
    date: '2026-01-01',
    issues: [1],
    prs: [2],
    description: 'Composed',
    facts: unassessed,
    transcript: unassessed,
    tools: { status: 'none-observed', reason: 'nothing' },
    architecture: { status: 'none-observed', reason: 'nothing' },
  }
  const PARTIAL = { status: 'partial', sources: [], droppedCount: 0 }
  const args = (compose: unknown) => ({
    ...BASE,
    feedbackCoverage: PARTIAL,
    compose,
  })

  it('composes the document, validates it, and previews it with dryRun', async () => {
    declarePolicy()
    const p = policy(accept)
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy })
    const result = jsonOf(await h.call('retrospective_save', { ...args(COMPOSE), dryRun: true }))
    expect(result.markdown).toContain('session_id: "native:owner"')
    expect(result.markdown).toContain('We did the work.')
    expect(p.requests[0]!.input.markdown).toBe(result.markdown)
    expect(h.fake.calls.get.length).toBeGreaterThan(0)
  })

  it('composes when the blackboard has no journal for the session yet', async () => {
    const h = harness(fixture(), {
      entriesError: Object.assign(new Error('nf'), { status: 404 }),
    })
    const result = await h.call('retrospective_save', { ...args(COMPOSE), dryRun: true })
    expect(result.isError).toBeUndefined()
    expect(jsonOf(result).markdown).toContain('We did the work.')
  })

  it('saves a composed document', async () => {
    const h = harness(fixture())
    const result = jsonOf(await h.call('retrospective_save', args(COMPOSE)))
    expect(result.status).toBe('delivered')
    expect(h.fake.stored[0]!.data).toMatchObject({ type: 'retrospective', prs: [2] })
  })

  it('runs facts and transcript collection against the worktree', async () => {
    const h = harness(fixture())
    const compose = {
      ...COMPOSE,
      facts: { noPr: true, branch: 'linked' },
      transcript: { sessionId: 'native:owner' },
    }
    const result = await h.call('retrospective_save', { ...args(compose), dryRun: true })
    expect(result.isError).toBeUndefined()
    expect(jsonOf(result).markdown).toContain('Verifiable Facts')
  })

  it('rejects unknown, missing, and mistyped compose keys', async () => {
    const h = harness(fixture())
    const call = async (compose: unknown) =>
      textOf(await h.call('retrospective_save', args(compose)))
    expect(await call({ ...COMPOSE, friction: {} })).toContain('unsupported argument(s): friction')
    expect(await call({ ...COMPOSE, facts: { execute: 'x' } })).toContain('execute')
    expect(await call({ ...COMPOSE, facts: undefined, tools: undefined })).toContain(
      'compose is missing: facts, tools',
    )
    expect(await call({ ...COMPOSE, facts: [] })).toContain('compose.facts must be an object')
  })
})

describe('retrospective_save redaction and event ids', () => {
  const TOKEN = 'sh0rt-tok'
  const env = { ...BLACKBOARD_ENV, AGENT_BLACKBOARD_TOKEN: TOKEN }

  it('keeps the blackboard token out of the policy input and the stored envelope', async () => {
    declarePolicy()
    const p = policy(accept)
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, env })
    const leaky = FRONT.replace('Did a thing', `Did ${TOKEN} thing`).replace(
      'Body of',
      `Body ${TOKEN} of`,
    )
    const result = await h.call('retrospective_save', { ...SAVE, markdown: leaky })
    expect(result.isError).toBeUndefined()
    const policyInput = p.requests.find((r) => r.name === 'validateRetrospective')!.input
    expect(JSON.stringify(policyInput)).not.toContain(TOKEN)
    expect(policyInput.markdown).toContain('Body [REDACTED] of')
    expect(policyInput.metadata).toMatchObject({ description: 'Did [REDACTED] thing' })
    expect(JSON.stringify(h.fake.stored)).not.toContain(TOKEN)
  })

  it('redacts the token and caller values from a composed document before the policy', async () => {
    declarePolicy()
    const p = policy(accept)
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, env })
    const unassessed = { status: 'not-assessed', reason: 'not inspected' }
    const compose = {
      narrative: `We saw ${TOKEN} and custom-secret.`,
      date: '2026-01-01',
      issues: [1],
      prs: [2],
      description: `Composed ${TOKEN}`,
      facts: unassessed,
      transcript: unassessed,
      tools: { status: 'none-observed', reason: 'nothing' },
      architecture: { status: 'none-observed', reason: 'nothing' },
      knownSensitiveValues: ['custom-secret'],
    }
    const feedbackCoverage = { status: 'partial', sources: [], droppedCount: 0 }
    const result = await h.call('retrospective_save', { ...BASE, feedbackCoverage, compose })
    expect(result.isError).toBeUndefined()
    const text = JSON.stringify([p.requests, h.fake.stored])
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('custom-secret')
  })

  it('defaults the event id to retrospective-<sessionId>, hashed when too long', async () => {
    expect(defaultSourceEventId('native:owner')).toBe('retrospective-native:owner')
    const long = `native:${'x'.repeat(300)}`
    expect(defaultSourceEventId(long)).toBe(
      `retrospective-${createHash('sha256').update(long).digest('hex')}`,
    )
    const exact = `native:${'y'.repeat(256 - 'retrospective-native:'.length)}`
    expect(defaultSourceEventId(exact)).toBe(`retrospective-${exact}`)
    const h = harness(fixture())
    await h.call('retrospective_save', SAVE)
    expect(h.fake.stored[0]!.data).toMatchObject({ sourceEventId: 'retrospective-native:owner' })
  })
})

describe('retrospective_check', () => {
  const retrospective = (
    sourceEventId: string,
    createdAt: string,
    issues?: number[],
    prs: number[] | undefined = [],
  ) => ({
    createdAt,
    data: { type: 'retrospective', sourceEventId, timestamp: createdAt, issues, prs },
  })

  it('reports saved: false for a session that was never created', async () => {
    const h = harness(fixture(), { entriesError: Object.assign(new Error('nf'), { status: 404 }) })
    expect(jsonOf(await h.call('retrospective_check', { sessionId: 's' }))).toEqual({
      sessionId: 's',
      saved: false,
      entries: [],
    })
    const other = harness(fixture(), {
      entriesError: Object.assign(new Error('nf'), { statusCode: 404 }),
    })
    expect(jsonOf(await other.call('retrospective_check', { sessionId: 's' })).saved).toBe(false)
  })

  it('lists only retrospective entries, oldest first, narrowed by sourceEventId', async () => {
    const h = harness(fixture(), {
      entries: [
        retrospective('b', '2026-01-02T00:00:00.000Z', [4]),
        { createdAt: '2026-01-01T00:00:00.000Z', data: { type: 'journal', sourceEventId: 'j' } },
        { createdAt: '2026-01-01T00:00:00.000Z' } as never,
        {
          ...retrospective('a', '2026-01-01T12:00:00.000Z'),
          data: { type: 'retrospective', sourceEventId: 'a' },
        },
      ],
    })
    const all = jsonOf(await h.call('retrospective_check', { sessionId: 's' }))
    expect(all).toMatchObject({ saved: true })
    expect((all.entries as Array<{ sourceEventId: string }>).map((e) => e.sourceEventId)).toEqual([
      'a',
      'b',
    ])
    expect((all.entries as Array<{ issues: unknown }>)[0]!.issues).toEqual([])
    expect((all.entries as Array<{ prs: unknown }>)[0]!.prs).toEqual([])
    const narrowed = jsonOf(
      await h.call('retrospective_check', { sessionId: 's', sourceEventId: 'b' }),
    )
    expect(narrowed.entries).toEqual([
      { sourceEventId: 'b', timestamp: '2026-01-02T00:00:00.000Z', issues: [4], prs: [] },
    ])
    const none = jsonOf(await h.call('retrospective_check', { sessionId: 's', sourceEventId: 'z' }))
    expect(none.saved).toBe(false)
  })

  it('fails on any other read error', async () => {
    const h = harness(fixture(), { entriesError: new Error('boom') })
    const result = await h.call('retrospective_check', { sessionId: 's' })
    expect(textOf(result)).toContain('boom')
  })
})
