import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createGhExec,
  createGhPostReviewIo,
  postReviewFromEnv,
  postWithGh,
  writePostedOutput,
  type GhExec,
} from './github.mts'
import type { ClaudeTokenIo } from './claude-token.mts'

const HEAD_SHA = 'b'.repeat(40)

function makeExec(handler: (args: readonly string[]) => string): GhExec {
  return (args) => handler(args)
}

describe('github review adapter', () => {
  it('posts through gh and maps HTTP failures', () => {
    const calls: string[][] = []
    const exec: GhExec = (args, options) => {
      calls.push([...args])
      expect(options?.env?.GH_TOKEN).toBe('tok')
      expect(options?.input).toContain('"event":"COMMENT"')
      return ''
    }
    expect(
      postWithGh(
        'o/r',
        '3',
        { event: 'COMMENT', commit_id: HEAD_SHA, body: 'ok', comments: [] },
        'tok',
        exec,
      ),
    ).toEqual({ ok: true, status: 201, body: '' })
    expect(calls[0]?.slice(0, 3)).toEqual(['api', '--method', 'POST'])

    const failing: GhExec = () => {
      throw Object.assign(new Error('gh failed'), { stderr: 'HTTP 422 Validation Failed' })
    }
    expect(
      postWithGh(
        'o/r',
        '3',
        { event: 'COMMENT', commit_id: HEAD_SHA, body: 'ok', comments: [] },
        'tok',
        failing,
      ),
    ).toMatchObject({ ok: false, status: 422 })

    const missing: GhExec = () => {
      throw new Error('spawn gh ENOENT')
    }
    expect(
      postWithGh(
        'o/r',
        '3',
        { event: 'COMMENT', commit_id: HEAD_SHA, body: 'ok', comments: [] },
        'tok',
        missing,
      ),
    ).toMatchObject({ ok: false, status: 0 })

    const stdoutFail: GhExec = () => {
      throw Object.assign(new Error('gh failed'), { stdout: 'HTTP 401 Unauthorized' })
    }
    expect(
      postWithGh(
        'o/r',
        '3',
        { event: 'COMMENT', commit_id: HEAD_SHA, body: 'ok', comments: [] },
        'tok',
        stdoutFail,
      ),
    ).toMatchObject({ ok: false, status: 401 })

    const bare: GhExec = () => {
      throw { stdout: 'HTTP 500 Internal Server Error' }
    }
    expect(
      postWithGh(
        'o/r',
        '3',
        { event: 'COMMENT', commit_id: HEAD_SHA, body: 'ok', comments: [] },
        'tok',
        bare,
      ),
    ).toMatchObject({ ok: false, status: 500 })
  })

  it('writes posted output only when GITHUB_OUTPUT is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'posted-output-'))
    const output = join(dir, 'github-output')
    try {
      writePostedOutput(true, '')
      writeFileSync(output, '')
      writePostedOutput(true, output)
      writePostedOutput(false, output)
      expect(readFileSync(output, 'utf8')).toBe('posted=true\nposted=false\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves the PR head, lists files, and deletes the payload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'post-review-io-'))
    const payloadPath = join(dir, 'code-review-payload.json')
    writeFileSync(payloadPath, '{"body":"ok","comments":[]}')
    const exec = makeExec((args) => {
      if (args.includes('.head.sha')) return HEAD_SHA
      return '[]'
    })
    const io = createGhPostReviewIo({
      repository: 'o/r',
      prNumber: '9',
      payloadPath,
      payloadBytes: Buffer.from('{"body":"ok"}'),
      token: 'tok',
      exec,
    })
    expect(io.readFile(payloadPath).toString()).toContain('ok')
    expect(io.getHeadSha()).toBe(HEAD_SHA)
    expect(io.listPullFiles()).toEqual([])
    io.removeFile(payloadPath)
    expect(() => readFileSync(payloadPath)).toThrow()
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a non-SHA head', () => {
    const io = createGhPostReviewIo({
      repository: 'o/r',
      prNumber: '9',
      payloadPath: '/tmp/x',
      payloadBytes: Buffer.from('{}'),
      token: 'tok',
      exec: () => 'not-a-sha',
    })
    expect(() => io.getHeadSha()).toThrow('Could not resolve PR head SHA')
  })

  it('wraps execFileSync as a gh helper', () => {
    const exec = createGhExec(((
      command: string,
      args: readonly string[],
      options: { encoding?: string },
    ) => {
      expect(command).toBe('gh')
      expect(args).toEqual(['api', 'ok'])
      expect(options.encoding).toBe('utf8')
      return '  value\n'
    }) as typeof import('node:child_process').execFileSync)
    expect(exec(['api', 'ok'])).toBe('value')
    expect(typeof createGhExec()).toBe('function')
  })
})

describe('postReviewFromEnv', () => {
  it('posts with a github-token and with a minted Claude App token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'post-review-env-'))
    const payloadPath = join(dir, 'code-review-payload.json')
    writeFileSync(payloadPath, JSON.stringify({ body: 'Verdict.', comments: [] }))
    const exec: GhExec = (args) => {
      if (args.includes('.head.sha')) return HEAD_SHA
      if (args.includes('/files?per_page=100')) return '[]'
      return ''
    }
    try {
      await expect(
        postReviewFromEnv(
          {
            GITHUB_REPOSITORY: 'o/r',
            PR_NUMBER: '4',
            CODE_REVIEW_PAYLOAD_PATH: payloadPath,
            CODE_REVIEW_TOKEN_SOURCE: 'github-token',
            GH_TOKEN: 'job-token',
          },
          exec,
        ),
      ).resolves.toEqual({ posted: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }

    const dir2 = mkdtempSync(join(tmpdir(), 'post-review-claude-'))
    const payload2 = join(dir2, 'code-review-payload.json')
    writeFileSync(payload2, JSON.stringify({ body: 'Verdict.', comments: [] }))
    const claudeIo: ClaudeTokenIo = {
      async getOidcToken() {
        return 'oidc'
      },
      async fetch() {
        return {
          ok: true,
          status: 200,
          async json() {
            return { token: 'app-token' }
          },
        }
      },
      mask() {},
    }
    try {
      await expect(
        postReviewFromEnv(
          {
            GITHUB_REPOSITORY: 'o/r',
            PR_NUMBER: '4',
            CODE_REVIEW_PAYLOAD_PATH: payload2,
          },
          exec,
          claudeIo,
        ),
      ).resolves.toEqual({ posted: true })
    } finally {
      rmSync(dir2, { recursive: true, force: true })
    }
  })
})
