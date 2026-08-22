import { describe, expect, it } from 'vitest'

import {
  CHECKPOINT_MARKER,
  isTrustedCheckpointComment,
  parseCheckpoint,
  renderCheckpoint,
  sortedCheckpointCandidates,
  validateCheckpoint,
  type Checkpoint,
} from './index.mts'

const startSha = 'a'.repeat(40)
const sessionId = 'sess-0123abcd'

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    marker: CHECKPOINT_MARKER,
    repository: 'acme/app',
    pr: 42,
    headRef: 'codex/fix',
    startSha,
    sessionStartSha: startSha,
    runId: '30189230576',
    runUrl: 'https://github.com/acme/app/actions/runs/30189230576',
    actor: 'github-actions[bot]',
    sessionId,
    resumeSourceRunId: '',
    status: 'failed',
    createdAt: '2026-07-26T05:35:55Z',
    updatedAt: '2026-07-26T05:35:55Z',
    ...overrides,
  }
}

function trustedBot() {
  return {
    user: { login: 'github-actions[bot]', type: 'Bot' },
    performed_via_github_app: { slug: 'github-actions' },
  }
}

describe('PR checkpoints', () => {
  it('renders a versioned machine-readable checkpoint body and round-trips it', () => {
    const value = checkpoint()
    const body = renderCheckpoint(value)
    expect(body).toContain(`<!-- ${CHECKPOINT_MARKER} `)
    expect(body).toContain(value.runUrl)
    expect(body).toContain('Session: `sess-0123abcd`')
    expect(parseCheckpoint(body)).toEqual(value)
  })

  it('renders remote session URLs as clickable links and pending sessions as placeholders', () => {
    expect(
      renderCheckpoint(
        checkpoint({ sessionUrl: 'https://harness.example/sessions/sess-0123abcd' }),
      ),
    ).toContain('Session: [sess-0123abcd](https://harness.example/sessions/sess-0123abcd)')
    expect(renderCheckpoint(checkpoint({ sessionId: '' }))).toContain('Session: `pending`')
  })

  it('parses a custom marker and rejects mismatched HTML comments', () => {
    const value = checkpoint({ marker: 'custom.checkpoint:v2' })
    const body = renderCheckpoint(value, { marker: 'custom.checkpoint:v2' })
    expect(parseCheckpoint(body, { marker: 'custom.checkpoint:v2' })).toEqual(value)
    expect(parseCheckpoint(body)).toBeUndefined()
    expect(
      parseCheckpoint(renderCheckpoint(checkpoint()), { marker: 'custom.checkpoint:v2' }),
    ).toBeUndefined()
    expect(
      parseCheckpoint(renderCheckpoint(checkpoint(), { marker: 'custom.checkpoint:v2' }), {
        marker: 'custom.checkpoint:v2',
      }),
    ).toEqual(checkpoint({ marker: 'custom.checkpoint:v2' }))
    expect(parseCheckpoint(`<!-- ${CHECKPOINT_MARKER} definitely-not-json -->`)).toBeUndefined()
    expect(parseCheckpoint('plain comment')).toBeUndefined()
  })

  it('validates required fields, optional trigger ids, and session URLs', () => {
    expect(validateCheckpoint(checkpoint({ triggerCommentId: 100 }))).toMatchObject({
      triggerCommentId: 100,
    })
    expect(validateCheckpoint(checkpoint({ resumeSourceRunId: '99' }))).toMatchObject({
      resumeSourceRunId: '99',
    })
    expect(
      validateCheckpoint(checkpoint({ sessionUrl: 'https://example.test/session' })),
    ).toMatchObject({ sessionUrl: 'https://example.test/session' })
    expect(validateCheckpoint(null)).toBeUndefined()
    expect(validateCheckpoint('checkpoint')).toBeUndefined()
    expect(validateCheckpoint(checkpoint({ marker: 'other' }))).toBeUndefined()
    expect(validateCheckpoint({ ...checkpoint(), pr: 1.5 })).toBeUndefined()
    expect(validateCheckpoint({ ...checkpoint(), triggerCommentId: 1.5 })).toBeUndefined()
    expect(validateCheckpoint({ ...checkpoint(), startSha: 'abc' })).toBeUndefined()
    expect(validateCheckpoint({ ...checkpoint(), sessionStartSha: 'abc' })).toBeUndefined()
    expect(validateCheckpoint({ ...checkpoint(), runId: 'run' })).toBeUndefined()
    expect(validateCheckpoint({ ...checkpoint(), resumeSourceRunId: 'run' })).toBeUndefined()
    expect(
      validateCheckpoint({ ...checkpoint(), repository: 1 as unknown as string }),
    ).toBeUndefined()
    expect(validateCheckpoint({ ...checkpoint(), headRef: 1 as unknown as string })).toBeUndefined()
    expect(validateCheckpoint({ ...checkpoint(), runUrl: 1 as unknown as string })).toBeUndefined()
    expect(validateCheckpoint({ ...checkpoint(), actor: 1 as unknown as string })).toBeUndefined()
    expect(
      validateCheckpoint({ ...checkpoint(), sessionId: 1 as unknown as string }),
    ).toBeUndefined()
    expect(validateCheckpoint({ ...checkpoint(), createdAt: 'nope' })).toBeUndefined()
    expect(validateCheckpoint({ ...checkpoint(), updatedAt: 'nope' })).toBeUndefined()
    expect(
      validateCheckpoint({ ...checkpoint(), createdAt: 1 as unknown as string }),
    ).toBeUndefined()
    expect(
      validateCheckpoint({ ...checkpoint(), updatedAt: 1 as unknown as string }),
    ).toBeUndefined()
    expect(
      validateCheckpoint({ ...checkpoint(), startSha: 1 as unknown as string }),
    ).toBeUndefined()
    expect(
      validateCheckpoint({ ...checkpoint(), sessionStartSha: 1 as unknown as string }),
    ).toBeUndefined()
    expect(validateCheckpoint({ ...checkpoint(), runId: 1 as unknown as string })).toBeUndefined()
    expect(
      validateCheckpoint({ ...checkpoint(), resumeSourceRunId: 1 as unknown as string }),
    ).toBeUndefined()
    expect(
      validateCheckpoint({ ...checkpoint(), status: 'other' as Checkpoint['status'] }),
    ).toBeUndefined()
    expect(
      validateCheckpoint({ ...checkpoint(), status: 1 as unknown as Checkpoint['status'] }),
    ).toBeUndefined()
    expect(validateCheckpoint(checkpoint({ sessionUrl: 'http://example.test' }))).toBeUndefined()
    expect(validateCheckpoint(checkpoint({ sessionUrl: 'not-a-url' }))).toBeUndefined()
  })

  it('enforces an optional session id pattern only for non-empty ids', () => {
    const pattern = /^sess-[0-9a-f]{8}$/u
    expect(validateCheckpoint(checkpoint(), { sessionIdPattern: pattern })).toEqual(checkpoint())
    expect(
      validateCheckpoint(checkpoint({ sessionId: 'nope' }), { sessionIdPattern: pattern }),
    ).toBeUndefined()
    expect(
      validateCheckpoint(checkpoint({ sessionId: '' }), { sessionIdPattern: pattern }),
    ).toMatchObject({
      sessionId: '',
    })
    expect(validateCheckpoint(checkpoint({ sessionId: 'nope' }))).toMatchObject({
      sessionId: 'nope',
    })
    const globalPattern = /sess-[0-9a-f]{8}/g
    const stickyPattern = /^sess-[0-9a-f]{8}$/y
    expect(validateCheckpoint(checkpoint(), { sessionIdPattern: globalPattern })).toEqual(
      checkpoint(),
    )
    expect(validateCheckpoint(checkpoint(), { sessionIdPattern: globalPattern })).toEqual(
      checkpoint(),
    )
    expect(validateCheckpoint(checkpoint(), { sessionIdPattern: stickyPattern })).toEqual(
      checkpoint(),
    )
    expect(validateCheckpoint(checkpoint(), { sessionIdPattern: stickyPattern })).toEqual(
      checkpoint(),
    )
  })

  it('accepts every checkpoint status', () => {
    for (const status of [
      'queued',
      'running',
      'awaiting_verification',
      'failed',
      'deadline',
      'unresumable',
      'complete',
    ] as const) {
      expect(validateCheckpoint(checkpoint({ status }))?.status).toBe(status)
    }
  })

  it('treats only the expected App identity as a trusted checkpoint comment', () => {
    const comment = { id: 1, ...trustedBot(), body: renderCheckpoint(checkpoint()) }
    expect(isTrustedCheckpointComment(comment, { actor: 'github-actions[bot]' })).toBe(true)
    expect(
      isTrustedCheckpointComment(
        {
          id: 2,
          user: { login: 'helper', type: 'User' },
          performed_via_github_app: { slug: 'my-app' },
        },
        { actor: 'helper', userType: 'User', appSlug: 'my-app' },
      ),
    ).toBe(true)
    expect(isTrustedCheckpointComment({ id: 3 }, { actor: 'github-actions[bot]' })).toBe(false)
    expect(
      isTrustedCheckpointComment(
        { id: 4, user: { login: 'human', type: 'User' }, performed_via_github_app: null },
        { actor: 'github-actions[bot]' },
      ),
    ).toBe(false)
    expect(
      isTrustedCheckpointComment(
        { ...comment, user: { login: 'github-actions[bot]', type: 'User' } },
        { actor: 'github-actions[bot]' },
      ),
    ).toBe(false)
  })

  it('sorts parseable checkpoint candidates by timestamp then comment id', () => {
    const older = renderCheckpoint(checkpoint({ status: 'running' }))
    const newer = renderCheckpoint(checkpoint({ status: 'failed' }))
    const candidates = sortedCheckpointCandidates([
      { id: 1, body: 'not a checkpoint', created_at: '2026-07-26T06:00:00Z' },
      { id: 42, ...trustedBot(), body: older, created_at: '2026-07-26T05:35:55Z' },
      { id: 43, ...trustedBot(), body: newer, created_at: '2026-07-26T05:35:55Z' },
      { id: 44, ...trustedBot(), body: renderCheckpoint(checkpoint({ status: 'queued' })) },
      { id: 40, ...trustedBot(), body: renderCheckpoint(checkpoint({ status: 'deadline' })) },
      {
        id: 45,
        ...trustedBot(),
        body: renderCheckpoint(checkpoint({ status: 'complete' })),
        created_at: '2026-07-26T06:00:00Z',
      },
    ])
    expect(candidates.map((candidate) => candidate.comment.id)).toEqual([45, 43, 42, 44, 40])
    expect(sortedCheckpointCandidates([{ id: 9 }])).toEqual([])
  })
})
