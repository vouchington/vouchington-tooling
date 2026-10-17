import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Action = {
  inputs: Record<string, { required?: boolean }>
  runs: {
    using: string
    steps: Array<{ shell?: string; env?: Record<string, string>; run?: string }>
  }
}

const path = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  '.github/actions/comment-harness-session/action.yml',
)
const source = readFileSync(path, 'utf8')
const action = load(source) as Action
const script = action.runs.steps[0]?.run ?? ''
const sessionId = 'sess-0123abcd'
const sessionUrl = `https://harness.example/sessions/${sessionId}`

// A stub `gh` that serves a canned paginated comment list through the real --jq filter and
// records every `gh issue comment` call.
function run(env: Record<string, string>, comments: unknown[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'comment-session-'))
  const log = join(dir, 'posted')
  const stub = [
    '#!/usr/bin/env bash',
    'if [ "$1" = api ]; then',
    '  while [ $# -gt 0 ]; do if [ "$1" = --jq ]; then shift; filter=$1; fi; shift; done',
    `  jq -r "$filter" ${JSON.stringify(join(dir, 'comments.json'))}`,
    'else',
    `  printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
    'fi',
  ].join('\n')
  writeFileSync(join(dir, 'gh'), stub)
  chmodSync(join(dir, 'gh'), 0o755)
  writeFileSync(join(dir, 'comments.json'), JSON.stringify(comments))
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'owner/repo',
      SESSION_ID: sessionId,
      SESSION_URL: sessionUrl,
      TARGET: '12',
      ...env,
    },
  })
  const posted = (() => {
    try {
      return readFileSync(log, 'utf8')
    } catch {
      return ''
    }
  })()
  return { ...result, posted }
}

const marker = `<!-- auto-harness-session:${sessionId} -->`

describe('comment-harness-session action', () => {
  it('is a composite action with the three required inputs', () => {
    expect(action.runs.using).toBe('composite')
    expect(Object.keys(action.inputs)).toEqual(['target', 'session-id', 'session-url'])
    for (const input of Object.values(action.inputs)) expect(input.required).toBe(true)
    expect(action.runs.steps[0]?.shell).toBe('bash')
    expect(action.runs.steps[0]?.env).toMatchObject({
      GH_TOKEN: '${{ github.token }}',
      TARGET: '${{ inputs.target }}',
      SESSION_ID: '${{ inputs.session-id }}',
      SESSION_URL: '${{ inputs.session-url }}',
    })
    expect(script).not.toContain('${{')
    expect(source).not.toMatch(/vouchington|voucha/iu)
  })

  it('posts the session link when no matching comment exists', () => {
    const result = run({})
    expect(result.status).toBe(0)
    expect(result.posted).toContain('issue comment 12 --repo owner/repo --body')
    expect(result.posted).toContain(`👀 [View the Auto Harness session](${sessionUrl}).`)
    expect(result.posted).toContain(marker)
  })

  it('skips a repeat only for a marker comment posted by the workflow bot', () => {
    const own = run({}, [{ user: { login: 'github-actions[bot]' }, body: `x\n${marker}` }])
    expect(own.status).toBe(0)
    expect(own.stdout).toContain('Session comment already exists on #12.')
    expect(own.posted).toBe('')
    const spoofed = run({}, [{ user: { login: 'someone' }, body: marker }])
    expect(spoofed.posted).toContain('issue comment 12')
  })

  it('refuses unexpected targets, session ids, and URLs', () => {
    const bad: Array<[Record<string, string>, string]> = [
      [{ TARGET: 'abc' }, 'non-numeric'],
      [{ TARGET: '0' }, 'non-numeric'],
      [{ SESSION_ID: 'sess-XYZ' }, 'session id'],
      [{ SESSION_URL: 'http://harness.example/sessions/' + sessionId }, 'session URL'],
      [{ SESSION_URL: `https://harness.example/other/${sessionId}` }, 'session URL'],
      [{ SESSION_URL: `https://a.example/\nhttps://evil.example/sessions/${sessionId}` }, 'URL'],
      [{ SESSION_URL: `https://a.example/[x](y)/sessions/${sessionId}` }, 'session URL'],
    ]
    for (const [env, message] of bad) {
      const result = run(env)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain(message)
      expect(result.posted).toBe('')
    }
  })
})
