import { describe, expect, it } from 'vitest'

import {
  CHECKPOINT_MARKER,
  renderCheckpoint,
  type Checkpoint,
  type GitHubComment,
} from './codec.mts'
import { selectResumeCheckpoint, type CheckpointSelectionContext } from './resume.mts'

const startSha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)
const sessionId = 'sess-0123abcd'

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    marker: CHECKPOINT_MARKER,
    repository: 'acme/app',
    pr: 8592,
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

function context(overrides: Partial<CheckpointSelectionContext> = {}): CheckpointSelectionContext {
  return {
    repository: 'acme/app',
    pr: 8592,
    headRef: 'codex/fix',
    headSha,
    actor: 'github-actions[bot]',
    isAncestor: (candidate) => candidate === startSha,
    isShepherdRun: (runId) => runId === '30189230576',
    ...overrides,
  }
}

function trustedBot() {
  return {
    user: { login: 'github-actions[bot]', type: 'Bot' },
    performed_via_github_app: { slug: 'github-actions' },
  }
}

describe('selectResumeCheckpoint', () => {
  it('accepts a trusted remote Harness session', () => {
    const result = selectResumeCheckpoint(
      [
        {
          id: 42,
          ...trustedBot(),
          body: renderCheckpoint(checkpoint()),
          created_at: '2026-07-26T05:35:55Z',
        },
      ],
      context(),
    )
    expect(result).toEqual({ checkpoint: checkpoint(), commentId: 42 })
  })

  it('keeps an awaiting-verification checkpoint resumable', () => {
    const awaiting = checkpoint({ status: 'awaiting_verification' })
    const result = selectResumeCheckpoint(
      [
        {
          id: 42,
          ...trustedBot(),
          body: renderCheckpoint(awaiting),
          created_at: '2026-07-26T05:35:55Z',
        },
      ],
      context(),
    )
    expect(result?.commentId).toBe(42)
    expect(result?.checkpoint.status).toBe('awaiting_verification')
  })

  it('treats a completed or unresumable checkpoint as unresumable', () => {
    for (const status of ['complete', 'unresumable'] as const) {
      const result = selectResumeCheckpoint(
        [
          {
            id: 42,
            ...trustedBot(),
            body: renderCheckpoint(checkpoint({ status })),
            created_at: '2026-07-26T05:35:55Z',
          },
        ],
        context(),
      )
      expect(result).toBeUndefined()
    }
  })

  it('rejects forged, mismatched, and divergent checkpoints', () => {
    const candidates: { value: Checkpoint; comment: Partial<GitHubComment> }[] = [
      {
        value: checkpoint(),
        comment: { user: { login: 'human', type: 'User' }, performed_via_github_app: null },
      },
      {
        value: checkpoint(),
        comment: {
          user: { login: 'github-actions[bot]', type: 'Bot' },
          performed_via_github_app: null,
        },
      },
      { value: checkpoint({ repository: 'other/repo' }), comment: trustedBot() },
      { value: checkpoint({ startSha: 'c'.repeat(40) }), comment: trustedBot() },
      { value: checkpoint({ runId: '999' }), comment: trustedBot() },
    ]
    for (const [index, candidate] of candidates.entries()) {
      const result = selectResumeCheckpoint(
        [{ id: index, ...candidate.comment, body: renderCheckpoint(candidate.value) }],
        context(),
      )
      expect(result).toBeUndefined()
    }
  })

  it('rejects a session whose original start is not an ancestor of the current head', () => {
    const result = selectResumeCheckpoint(
      [
        {
          id: 1,
          ...trustedBot(),
          body: renderCheckpoint(checkpoint({ sessionStartSha: 'c'.repeat(40) })),
        },
      ],
      context(),
    )
    expect(result).toBeUndefined()
  })

  it('preserves the original trusted session start across descendant-head resumptions', () => {
    const resumedCheckpoint = checkpoint({
      startSha: headSha,
      sessionStartSha: startSha,
      resumeSourceRunId: '30180000000',
    })
    const result = selectResumeCheckpoint(
      [{ id: 43, ...trustedBot(), body: renderCheckpoint(resumedCheckpoint) }],
      context({ isAncestor: (candidate) => candidate === headSha || candidate === startSha }),
    )
    expect(result?.checkpoint.startSha).toBe(headSha)
    expect(result?.checkpoint.sessionStartSha).toBe(startSha)
    expect(result?.checkpoint.resumeSourceRunId).toBe('30180000000')
  })

  it('returns undefined when no candidate comments contain a checkpoint', () => {
    expect(selectResumeCheckpoint([{ id: 1, body: 'just a comment' }], context())).toBeUndefined()
  })
})

describe('selectResumeCheckpoint with caller-supplied codec options', () => {
  const customMarker = 'acme-checkpoint:v1'
  const sessionIdPattern = /^acme-[0-9a-f]{8}$/u

  it('matches a checkpoint rendered with a caller-supplied marker', () => {
    const result = selectResumeCheckpoint(
      [
        {
          id: 42,
          ...trustedBot(),
          body: renderCheckpoint(checkpoint(), { marker: customMarker }),
          created_at: '2026-07-26T05:35:55Z',
        },
      ],
      context(),
      { marker: customMarker },
    )
    expect(result?.commentId).toBe(42)
  })

  it('does not match a caller-marker checkpoint when no marker option is passed', () => {
    const result = selectResumeCheckpoint(
      [
        {
          id: 42,
          ...trustedBot(),
          body: renderCheckpoint(checkpoint(), { marker: customMarker }),
          created_at: '2026-07-26T05:35:55Z',
        },
      ],
      context(),
    )
    expect(result).toBeUndefined()
  })

  it('rejects a session id that does not match a caller-supplied pattern', () => {
    const result = selectResumeCheckpoint(
      [
        {
          id: 42,
          ...trustedBot(),
          body: renderCheckpoint(checkpoint()),
          created_at: '2026-07-26T05:35:55Z',
        },
      ],
      context(),
      { sessionIdPattern },
    )
    expect(result).toBeUndefined()
  })
})
