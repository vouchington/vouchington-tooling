import { describe, expect, it } from 'vitest'

import { CHECKPOINT_MARKER, parseCheckpoint, renderCheckpoint, type Checkpoint } from './codec.mts'
import { updateExactCheckpoint, type CheckpointUpdateContext } from './update.mts'

const startSha = 'a'.repeat(40)
const sessionId = 'sess-0123abcd'

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    marker: CHECKPOINT_MARKER,
    repository: 'acme/app',
    pr: 8592,
    triggerCommentId: 100,
    headRef: 'codex/fix',
    startSha,
    sessionStartSha: startSha,
    runId: '30189230576',
    runUrl: 'https://github.com/acme/app/actions/runs/30189230576',
    actor: 'github-actions[bot]',
    sessionId,
    resumeSourceRunId: '',
    status: 'queued',
    createdAt: '2026-07-26T05:35:55Z',
    updatedAt: '2026-07-26T05:35:55Z',
    ...overrides,
  }
}

function trustedComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    user: { login: 'github-actions[bot]', type: 'Bot' },
    performed_via_github_app: { slug: 'github-actions' },
    body: renderCheckpoint(checkpoint()),
    ...overrides,
  }
}

function context(overrides: Partial<CheckpointUpdateContext> = {}): CheckpointUpdateContext {
  return {
    actor: 'github-actions[bot]',
    commentId: 42,
    headRef: 'codex/fix',
    headSha: startSha,
    pr: 8592,
    repository: 'acme/app',
    runId: '30189230576',
    triggerCommentId: 100,
    ...overrides,
  }
}

describe('updateExactCheckpoint', () => {
  it('updates the exact trusted checkpoint binding with a session URL', () => {
    const rendered = updateExactCheckpoint(trustedComment(), context(), 'running', {
      id: sessionId,
      url: `https://harness.example.com/sessions/${sessionId}`,
    })
    const updated = parseCheckpoint(rendered)
    expect(updated?.status).toBe('running')
    expect(updated?.sessionId).toBe(sessionId)
    expect(updated?.sessionUrl).toContain(sessionId)
  })

  it('rejects a comment whose binding no longer matches the active context', () => {
    const comment = trustedComment()
    for (const override of [
      { commentId: 43 },
      { headSha: 'c'.repeat(40) },
      { pr: 1 },
      { runId: '1' },
    ]) {
      expect(() => updateExactCheckpoint(comment, context(override), 'failed', {})).toThrow(
        /Checkpoint comment/u,
      )
    }
  })

  it('rejects an untrusted comment author even with a matching body', () => {
    const comment = trustedComment({ user: { login: 'someone-else', type: 'Bot' } })
    expect(() => updateExactCheckpoint(comment, context(), 'failed', {})).toThrow(
      /Checkpoint comment/u,
    )
  })

  it('rejects a comment without a parseable checkpoint body', () => {
    const comment = trustedComment({ body: 'not a checkpoint' })
    expect(() => updateExactCheckpoint(comment, context(), 'failed', {})).toThrow(
      /Checkpoint comment/u,
    )
  })

  it('requires a session id and URL to transition to running', () => {
    expect(() => updateExactCheckpoint(trustedComment(), context(), 'running', {})).toThrow(
      /Running checkpoint requires/u,
    )
  })

  it('rejects a malformed or non-https session URL', () => {
    expect(() =>
      updateExactCheckpoint(trustedComment(), context(), 'running', {
        id: sessionId,
        url: `http://harness.example.com/sessions/${sessionId}`,
      }),
    ).toThrow(/Session URL must be/u)
  })

  it('allows transitioning to failed without a session', () => {
    const rendered = updateExactCheckpoint(trustedComment(), context(), 'failed', {})
    expect(parseCheckpoint(rendered)?.status).toBe('failed')
  })
})
