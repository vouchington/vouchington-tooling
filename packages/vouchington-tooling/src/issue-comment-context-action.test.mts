import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { afterAll, describe, expect, it } from 'vitest'

type Action = {
  inputs: Record<string, { required?: boolean; default?: string }>
  outputs: Record<string, { value: string }>
  runs: {
    using: string
    steps: Array<{ id?: string; shell?: string; env?: Record<string, string>; run?: string }>
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const actionDir = join(root, '.github/actions/issue-comment-context')
const source = readFileSync(join(actionDir, 'action.yml'), 'utf8')
const action = load(source) as Action
const script = action.runs.steps[0]?.run ?? ''
const scratch = mkdtempSync(join(tmpdir(), 'issue-comment-context-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

type Comment = {
  id: number
  user: { login: string } | null
  body: string | null
  created_at: string
}

function makeComments(count: number, body = 'hello'): Comment[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    user: { login: `u${i + 1}` },
    body,
    created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`.replace(
      /^2026-01-01/u,
      `2026-01-${String(1 + Math.floor(i / 60)).padStart(2, '0')}`,
    ),
  }))
}

// A stub `gh api` that serves the issue and 100-comment pages from fixtures and logs each path.
let counter = 0
function run(env: Record<string, string>, comments: Comment[], issueExtra: object = {}) {
  const dir = join(scratch, `case-${counter++}`)
  spawnSync('mkdir', ['-p', dir])
  const issue = {
    body: 'issue body',
    labels: [{ name: 'bug' }, { name: 'p1' }],
    comments: comments.length,
    ...issueExtra,
  }
  writeFileSync(join(dir, 'issue.json'), JSON.stringify(issue))
  for (let page = 1; page <= Math.ceil(comments.length / 100); page++) {
    writeFileSync(
      join(dir, `page-${page}.json`),
      JSON.stringify(
        comments
          .slice((page - 1) * 100, page * 100)
          .map((c) => ({ ...c, updated_at: c.created_at })),
      ),
    )
  }
  const stub = [
    '#!/usr/bin/env bash',
    `printf '%s\\n' "$2" >> ${JSON.stringify(join(dir, 'calls'))}`,
    'case "$2" in',
    `  *comments*page=*) page="\${2##*page=}"; cat ${JSON.stringify(dir)}/page-$page.json ;;`,
    `  *) cat ${JSON.stringify(join(dir, 'issue.json'))} ;;`,
    'esac',
  ].join('\n')
  writeFileSync(join(dir, 'gh'), stub)
  chmodSync(join(dir, 'gh'), 0o755)
  const output = join(dir, 'github-output')
  writeFileSync(output, '')
  const result = spawnSync('bash', ['-c', script], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      ACTION_PATH: actionDir,
      RUNNER_TEMP: dir,
      GITHUB_OUTPUT: output,
      GH_TOKEN: 'token',
      ISSUE_NUMBER: '7',
      REPOSITORY: 'owner/repo',
      MAX_COMMENTS: '100',
      MAX_COMMENT_CHARS: '2000',
      OUTPUT_PATH: join(dir, 'issue-context.json'),
      ...env,
    },
  })
  const read = (name: string) => readFileSync(join(dir, name), 'utf8')
  const context = () =>
    JSON.parse(read('issue-context.json')) as {
      body: string
      labels: string[]
      comments: Array<{ id: number; author: string | null; body: string; bodyTruncated: boolean }>
      commentSnapshot: { total: number; included: number; capped: boolean; maxCommentChars: number }
    }
  return { ...result, dir, read, context }
}

describe('issue-comment-context action', () => {
  it('is a composite bash action that routes every input through env', () => {
    const step = action.runs.steps[0]
    expect(action.runs.using).toBe('composite')
    expect(step?.shell).toBe('bash')
    expect(step?.id).toBe('capture')
    expect(step?.env).toMatchObject({
      GH_TOKEN: '${{ inputs.token }}',
      ISSUE_NUMBER: '${{ inputs.number }}',
      REPOSITORY: '${{ inputs.repository }}',
      MAX_COMMENTS: '${{ inputs.max-comments }}',
      MAX_COMMENT_CHARS: '${{ inputs.max-comment-chars }}',
      OUTPUT_PATH: '${{ inputs.output-path }}',
    })
    expect(script).not.toContain('${{')
    expect(action.inputs.number?.required).toBe(true)
    expect(action.inputs.token?.default).toBe('${{ github.token }}')
    expect(action.inputs['max-comments']?.default).toBe('100')
    expect(action.inputs['max-comment-chars']?.default).toBe('2000')
    expect(Object.keys(action.outputs)).toEqual(['context-file', 'context'])
    // The only package reference is the path of the bundled output helper.
    expect(source.replaceAll('packages/vouchington-tooling/', '')).not.toMatch(
      /vouchington|voucha/iu,
    )
  })

  it('snapshots the body, labels, comments and metadata of a small issue', () => {
    const result = run({}, makeComments(3))
    expect(result.status).toBe(0)
    const context = result.context()
    expect(context.body).toBe('issue body')
    expect(context.labels).toEqual(['bug', 'p1'])
    expect(context.comments.map((c) => c.id)).toEqual([1, 2, 3])
    expect(context.comments[0]).toMatchObject({ author: 'u1', body: 'hello', bodyTruncated: false })
    expect(context.commentSnapshot).toEqual({
      total: 3,
      included: 3,
      capped: false,
      maxCommentChars: 2000,
    })
  })

  it('handles an issue with no comments without fetching comment pages', () => {
    const result = run({}, [])
    expect(result.status).toBe(0)
    expect(result.context().comments).toEqual([])
    expect(result.context().commentSnapshot).toEqual({
      total: 0,
      included: 0,
      capped: false,
      maxCommentChars: 2000,
    })
    expect(result.read('calls')).not.toContain('comments?')
  })

  it('truncates each comment body and flags it, tolerating null bodies and users', () => {
    const comments = makeComments(2, 'abcdefghij')
    comments[1] = { ...comments[1]!, body: null, user: null }
    const result = run({ MAX_COMMENT_CHARS: '4' }, comments)
    expect(result.status).toBe(0)
    const { comments: kept, commentSnapshot } = result.context()
    expect(kept[0]).toMatchObject({ body: 'abcd', bodyTruncated: true })
    expect(kept[1]).toMatchObject({ author: null, body: '', bodyTruncated: false })
    expect(commentSnapshot.maxCommentChars).toBe(4)
  })

  it('keeps the newest N comments from the last two pages and marks the snapshot capped', () => {
    const result = run({}, makeComments(250))
    expect(result.status).toBe(0)
    const { comments, commentSnapshot } = result.context()
    expect(comments).toHaveLength(100)
    expect(comments[0]?.id).toBe(151)
    expect(comments.at(-1)?.id).toBe(250)
    expect(commentSnapshot).toMatchObject({ total: 250, included: 100, capped: true })
    expect(result.read('calls')).toContain('page=2')
    expect(result.read('calls')).toContain('page=3')
    expect(result.read('calls')).not.toContain('page=1\n')
  })

  it('honors a smaller max-comments and fetches more pages for a larger one', () => {
    const small = run({ MAX_COMMENTS: '5' }, makeComments(12))
    expect(small.context().comments.map((c) => c.id)).toEqual([8, 9, 10, 11, 12])
    expect(small.context().commentSnapshot).toMatchObject({ included: 5, capped: true })

    const large = run({ MAX_COMMENTS: '150' }, makeComments(250))
    expect(large.context().comments).toHaveLength(150)
    expect(large.context().comments[0]?.id).toBe(101)
    expect(large.context().commentSnapshot.capped).toBe(true)
  })

  it('writes the file path and the multiline JSON as outputs', () => {
    const result = run({}, makeComments(1))
    const output = result.read('github-output')
    expect(output).toContain(`context-file=${join(result.dir, 'issue-context.json')}\n`)
    expect(output).toMatch(/context<<CONTEXT_[0-9A-F]{32}\n/u)
    expect(output).toContain('"commentSnapshot"')
  })

  it.each([
    [{ ISSUE_NUMBER: '0' }, 'ISSUE_NUMBER'],
    [{ ISSUE_NUMBER: '7; echo' }, 'ISSUE_NUMBER'],
    [{ MAX_COMMENTS: 'x' }, 'MAX_COMMENTS'],
    [{ MAX_COMMENT_CHARS: '-1' }, 'MAX_COMMENT_CHARS'],
    [{ REPOSITORY: 'no-slash' }, 'repository'],
  ])('rejects invalid input %j', (env, name) => {
    const result = run(env, [])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(`::error::${name}`)
  })
})
