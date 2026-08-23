import { describe, expect, it } from 'vitest'

import { snapReviewNote as snapNote } from '../gha-review-payload/index.mts'
import {
  MAX_COMMENTS,
  MAX_PAYLOAD_BYTES,
  PostReviewError,
  runPostReview,
  type PostResult,
  type PostReviewIo,
  type PullFile,
  type SanitizedReview,
} from './post.mts'

const HEAD_SHA = 'a'.repeat(40)
const PAYLOAD_PATH = '/runner-temp/code-review-payload.json'

function makeComment(
  overrides: Partial<{ path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }> = {},
) {
  return {
    path: 'src/foo.mts',
    line: 7,
    side: 'RIGHT' as const,
    body: 'Finding on `data-stores-primary.cjs`.',
    ...overrides,
  }
}

function coveringFile(filename: string, line = 80): PullFile {
  const rows = Array.from({ length: line }, () => ' unchanged')
  return {
    filename,
    patch: `@@ -1,${line} +1,${line} @@\n${rows.join('\n')}\n`,
  }
}

function filesCoveringPayload(file: Buffer | string | null): PullFile[] {
  if (file === null || file === '') return []
  try {
    const parsed = JSON.parse(Buffer.isBuffer(file) ? file.toString('utf8') : file) as {
      comments?: Array<{ path?: string }>
    }
    const paths = new Set(
      (parsed.comments ?? [])
        .map((entry) => entry.path)
        .filter((path): path is string => typeof path === 'string'),
    )
    return [...paths].map((path) => coveringFile(path))
  } catch {
    return []
  }
}

function makeIo(options: {
  file?: Buffer | string | null
  posts?: PostResult[]
  files?: PullFile[]
  listPullFiles?: () => PullFile[]
}): {
  io: PostReviewIo
  posts: SanitizedReview[]
  removed: string[]
} {
  const posts: SanitizedReview[] = []
  const removed: string[] = []
  const queue = [...(options.posts ?? [{ ok: true, status: 201, body: '' }])]
  const file = options.file === undefined ? null : options.file
  const io: PostReviewIo = {
    readFile(path) {
      expect(path).toBe(PAYLOAD_PATH)
      if (file === null) throw new PostReviewError('Review payload is required.')
      return Buffer.isBuffer(file) ? file : Buffer.from(file)
    },
    removeFile(path) {
      removed.push(path)
    },
    getHeadSha() {
      return HEAD_SHA
    },
    listPullFiles() {
      if (options.listPullFiles) return options.listPullFiles()
      if (options.files) return options.files
      return filesCoveringPayload(file)
    },
    postReview(payload) {
      posts.push(payload)
      return queue.shift() ?? { ok: false, status: 500, body: 'unexpected extra POST' }
    },
  }
  return { io, posts, removed }
}

describe('runPostReview', () => {
  it('rejects empty, oversized, and non-object payloads and still removes the file', () => {
    const cases: Array<Buffer | string> = ['', '{', '[]', Buffer.alloc(MAX_PAYLOAD_BYTES + 1)]
    for (const file of cases) {
      const { io, posts, removed } = makeIo({ file })
      expect(() => runPostReview(PAYLOAD_PATH, io)).toThrow(PostReviewError)
      expect(posts).toEqual([])
      expect(removed).toEqual([PAYLOAD_PATH])
    }
  })

  it('posts one COMMENT review, drops extra fields, and forces the PR head SHA', () => {
    const { io, posts, removed } = makeIo({
      file: JSON.stringify({
        event: 'APPROVE',
        commit_id: 'attacker-sha',
        foo: 'nope',
        body: '1. `RateLimiterOptions` is re-exported from `valkyries`.',
        comments: [
          {
            ...makeComment({
              body: "Uses `import-progress-pubsub.mts` and `setValkeyErrorHandler(onError)`.\n\n```suggestion\nimport '@data-stores/valkey-core/app-integration'\n```",
            }),
            bar: 'drop-me',
          },
        ],
      }),
    })

    expect(runPostReview(PAYLOAD_PATH, io)).toEqual({ posted: true })
    expect(posts).toHaveLength(1)
    expect(posts[0]).toEqual({
      event: 'COMMENT',
      commit_id: HEAD_SHA,
      body: '1. `RateLimiterOptions` is re-exported from `valkyries`.',
      comments: [
        makeComment({
          body: "Uses `import-progress-pubsub.mts` and `setValkeyErrorHandler(onError)`.\n\n```suggestion\nimport '@data-stores/valkey-core/app-integration'\n```",
        }),
      ],
    })
    expect(removed).toEqual([PAYLOAD_PATH])
  })

  it('keeps the first 15 comments and lists the rest in the body', () => {
    const comments = Array.from({ length: MAX_COMMENTS + 1 }, (_, index) =>
      makeComment({ line: index + 1, path: `src/${index + 1}.mts`, body: `Finding ${index + 1}` }),
    )
    const { io, posts } = makeIo({
      file: JSON.stringify({ body: 'Verdict.', comments }),
    })

    expect(runPostReview(PAYLOAD_PATH, io)).toEqual({ posted: true })
    expect(posts[0]?.comments).toHaveLength(MAX_COMMENTS)
    expect(posts[0]?.body).toContain('Verdict.')
    expect(posts[0]?.body).toContain('src/16.mts:16')
    expect(posts[0]?.body).toContain('Finding 16')
  })

  it('retries once as body-only COMMENT after a 422', () => {
    const { io, posts } = makeIo({
      file: JSON.stringify({
        body: 'Verdict.',
        comments: [makeComment({ path: 'src/bad.mts', line: 3, body: 'Invalid line' })],
      }),
      posts: [
        { ok: false, status: 422, body: 'Validation Failed' },
        { ok: true, status: 201, body: '' },
      ],
    })

    expect(runPostReview(PAYLOAD_PATH, io)).toEqual({ posted: true })
    expect(posts).toHaveLength(2)
    expect(posts[0]?.comments).toHaveLength(1)
    expect(posts[1]).toMatchObject({
      event: 'COMMENT',
      commit_id: HEAD_SHA,
      comments: [],
    })
    expect(posts[1]?.body).toContain('src/bad.mts:3')
    expect(posts[1]?.body).toContain('Invalid line')
    expect(posts[1]?.body).toContain('HTTP 422')
  })

  it('does not retry a non-422 failure and still removes the file', () => {
    const { io, posts, removed } = makeIo({
      file: JSON.stringify({ body: 'Verdict.', comments: [] }),
      posts: [{ ok: false, status: 500, body: 'boom' }],
    })

    expect(() => runPostReview(PAYLOAD_PATH, io)).toThrow(PostReviewError)
    expect(posts).toHaveLength(1)
    expect(removed).toEqual([PAYLOAD_PATH])
  })

  it('throws when the 422 fallback POST also fails', () => {
    const { io, posts, removed } = makeIo({
      file: JSON.stringify({ body: 'Verdict.', comments: [] }),
      posts: [
        { ok: false, status: 422, body: 'Validation Failed' },
        { ok: false, status: 500, body: 'still bad' },
      ],
    })
    expect(() => runPostReview(PAYLOAD_PATH, io)).toThrow('GitHub review POST retry failed')
    expect(posts).toHaveLength(2)
    expect(removed).toEqual([PAYLOAD_PATH])
  })

  it('keeps in-hunk comments and snaps out-of-hunk comments instead of dropping all inlines', () => {
    const { io, posts } = makeIo({
      file: JSON.stringify({
        body: 'Verdict.',
        comments: [
          makeComment({ path: 'src/hook.ts', line: 40, body: 'out of hunk' }),
          makeComment({ path: 'src/hook.ts', line: 30, body: 'in hunk' }),
        ],
      }),
      files: [
        {
          filename: 'src/hook.ts',
          patch: `@@ -9,24 +9,24 @@\n${Array.from({ length: 24 }, () => ' unchanged').join('\n')}\n`,
        },
      ],
    })
    expect(runPostReview(PAYLOAD_PATH, io)).toEqual({ posted: true })
    expect(posts).toHaveLength(1)
    expect(
      posts[0]?.comments.map((entry) => entry.line).sort((left, right) => left - right),
    ).toEqual([30, 32])
    expect(posts[0]?.body).toBe('Verdict.')
    expect(posts[0]?.comments.find((entry) => entry.line === 32)?.body).toContain(
      snapNote('src/hook.ts', 40),
    )
  })

  it('lists remapped comments on the last-resort 422 body retry', () => {
    const { io, posts } = makeIo({
      file: JSON.stringify({
        body: 'Verdict.',
        comments: [makeComment({ path: 'src/hook.ts', line: 40, body: 'out of hunk' })],
      }),
      files: [
        {
          filename: 'src/hook.ts',
          patch: `@@ -9,24 +9,24 @@\n${Array.from({ length: 24 }, () => ' unchanged').join('\n')}\n`,
        },
      ],
      posts: [
        { ok: false, status: 422, body: 'Validation Failed' },
        { ok: true, status: 201, body: '' },
      ],
    })
    expect(runPostReview(PAYLOAD_PATH, io)).toEqual({ posted: true })
    expect(posts[0]?.comments.map((entry) => entry.line)).toEqual([32])
    expect(posts[1]?.comments).toEqual([])
    expect(posts[1]?.body).toContain('src/hook.ts:32')
    expect(posts[1]?.body).toContain(snapNote('src/hook.ts', 40))
    expect(posts[1]?.body).toContain('HTTP 422')
  })

  it('falls back to posting the parsed payload when listPullFiles throws', () => {
    const { io, posts } = makeIo({
      file: JSON.stringify({
        body: 'Verdict.',
        comments: [makeComment({ path: 'src/outside.mts', line: 400, body: 'no remap' })],
      }),
      listPullFiles() {
        throw new Error('github down')
      },
    })
    expect(runPostReview(PAYLOAD_PATH, io)).toEqual({ posted: true })
    expect(posts[0]?.comments).toEqual([
      makeComment({ path: 'src/outside.mts', line: 400, body: 'no remap' }),
    ])
  })

  it('drops comments that are missing start_side or a usable body', () => {
    const { io, posts } = makeIo({
      file: JSON.stringify({
        body: 'Verdict.',
        comments: [
          { path: 'src/a.mts', line: 2, side: 'RIGHT', body: 'ok', start_line: 1 },
          { path: 'src/b.mts', line: 4, side: 'RIGHT', body: '' },
          makeComment({ path: 'src/c.mts', line: 9, body: 'kept' }),
        ],
      }),
    })

    expect(runPostReview(PAYLOAD_PATH, io)).toEqual({ posted: true })
    expect(posts[0]?.comments).toEqual([makeComment({ path: 'src/c.mts', line: 9, body: 'kept' })])
  })
})
