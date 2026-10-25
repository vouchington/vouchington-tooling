import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Action = {
  inputs: Record<string, { default?: string }>
  runs: {
    using: string
    steps: Array<{ shell?: string; env?: Record<string, string>; run?: string }>
  }
}

const path = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  '.github/actions/comment-command-acknowledge/action.yml',
)
const source = readFileSync(path, 'utf8')
const action = load(source) as Action
const script = action.runs.steps[0]?.run ?? ''
const runUrl = 'https://github.example/owner/repo/actions/runs/5'

// A stub `gh` that records every call and fails the `api` (reaction) or `issue` (comment) call on demand.
function run(env: Record<string, string>, failing: Array<'api' | 'issue'> = []) {
  const dir = mkdtempSync(join(tmpdir(), 'comment-acknowledge-'))
  const log = join(dir, 'calls')
  const summary = join(dir, 'summary')
  const stub = [
    '#!/usr/bin/env bash',
    `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
    ...failing.map((verb) => `[ "$1" = ${verb} ] && exit 1`),
    'exit 0',
  ].join('\n')
  writeFileSync(join(dir, 'gh'), stub)
  chmodSync(join(dir, 'gh'), 0o755)
  writeFileSync(log, '')
  writeFileSync(summary, '')
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_STEP_SUMMARY: summary,
      COMMAND: '/fix',
      COMMENT_ID: '77',
      ISSUE_NUMBER: '12',
      POST_RUN_LINK: 'true',
      RUN_ATTEMPT: '1',
      RUN_URL: runUrl,
      ...env,
    },
  })
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean)
  return { ...result, calls, summary: readFileSync(summary, 'utf8') }
}

describe('comment-command-acknowledge action', () => {
  it('is a composite action that passes every input through env', () => {
    expect(action.runs.using).toBe('composite')
    expect(action.inputs['post-run-link']?.default).toBe('true')
    expect(action.inputs['comment-id']?.default).toBe('${{ github.event.comment.id }}')
    expect(action.inputs['token']?.default).toBe('${{ github.token }}')
    expect(action.runs.steps[0]?.shell).toBe('bash')
    expect(action.runs.steps[0]?.env).toMatchObject({
      GH_TOKEN: '${{ inputs.token }}',
      COMMAND: '${{ inputs.command }}',
      COMMENT_ID: '${{ inputs.comment-id }}',
      ISSUE_NUMBER: '${{ inputs.issue-number }}',
      POST_RUN_LINK: '${{ inputs.post-run-link }}',
      RUN_ATTEMPT: '${{ github.run_attempt }}',
    })
    expect(script).not.toContain('${{')
    expect(source).not.toMatch(/vouchington|voucha/iu)
  })

  it('reacts with eyes and posts the run link on the first attempt', () => {
    const result = run({})
    expect(result.status).toBe(0)
    expect(result.calls).toEqual([
      'api -X POST /repos/owner/repo/issues/comments/77/reactions -f content=eyes',
      `issue comment 12 --repo owner/repo --body 👀 [View the automation workflow run](${runUrl}).`,
    ])
  })

  it('skips the run-link comment on a retry', () => {
    const result = run({ RUN_ATTEMPT: '2' })
    expect(result.status).toBe(0)
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0]).toContain('reactions')
  })

  it('only reacts when post-run-link is false', () => {
    const result = run({ POST_RUN_LINK: 'false' })
    expect(result.status).toBe(0)
    expect(result.calls).toHaveLength(1)
  })

  it('warns and still posts the comment when the reaction fails', () => {
    const result = run({}, ['api'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('::warning::Could not add eyes reaction to /fix comment')
    expect(result.summary).toContain('## /fix acknowledgement warning')
    expect(result.calls).toHaveLength(2)
  })

  it('warns and continues when the run-link comment fails', () => {
    const result = run({}, ['issue'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('::warning::Could not post workflow run link for /fix')
    expect(result.stdout).not.toContain('eyes reaction')
  })

  it('warns twice and still succeeds when both calls fail', () => {
    const result = run({}, ['api', 'issue'])
    expect(result.status).toBe(0)
    expect(result.stdout.match(/::warning::/gu)).toHaveLength(2)
  })

  it('tolerates an unset step summary file', () => {
    const result = run({ GITHUB_STEP_SUMMARY: '' }, ['api'])
    expect(result.status).toBe(0)
  })
})
