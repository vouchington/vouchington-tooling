import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Action = {
  inputs: Record<string, { required?: boolean; default?: string }>
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
      STATUS: 'started',
      HEADLINE: '',
      DETAILS: '',
      RUN_LABEL: '',
      RUN_URL: '',
      SESSION_LABEL: 'Harness session',
      CLOSING: '',
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
  it('is a composite action that passes every input through env', () => {
    expect(action.runs.using).toBe('composite')
    expect(Object.keys(action.inputs)).toEqual([
      'target',
      'session-id',
      'session-url',
      'status',
      'headline',
      'details',
      'run-label',
      'run-url',
      'session-label',
      'closing',
    ])
    expect(action.inputs.target?.required).toBe(true)
    expect(action.inputs.status?.default).toBe('started')
    expect(action.runs.steps[0]?.shell).toBe('bash')
    expect(action.runs.steps[0]?.env).toMatchObject({
      GH_TOKEN: '${{ github.token }}',
      TARGET: '${{ inputs.target }}',
      SESSION_ID: '${{ inputs.session-id }}',
      SESSION_URL: '${{ inputs.session-url }}',
      STATUS: '${{ inputs.status }}',
      HEADLINE: '${{ inputs.headline }}',
      DETAILS: '${{ inputs.details }}',
      RUN_LABEL: '${{ inputs.run-label }}',
      RUN_URL: '${{ inputs.run-url }}',
      SESSION_LABEL: '${{ inputs.session-label }}',
      CLOSING: '${{ inputs.closing }}',
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

  describe('failed and cancelled status', () => {
    const runUrl = 'https://github.example/owner/repo/actions/runs/9'
    const failure = {
      HEADLINE: '/fix run failed — auto-fix could not complete.',
      RUN_LABEL: 'Auto-fix run',
      RUN_URL: runUrl,
      SESSION_LABEL: 'Harness session',
      CLOSING: 'Please investigate manually or re-comment `/fix` to retry.\n',
    }

    it('posts the failure comment with the run URL and the session id', () => {
      for (const status of ['failed', 'cancelled']) {
        const result = run({ ...failure, STATUS: status })
        expect(result.status).toBe(0)
        expect(result.posted).toBe(
          [
            'issue comment 12 --repo owner/repo --body /fix run failed — auto-fix could not complete.',
            '',
            `**Auto-fix run:** ${runUrl}`,
            `**Harness session:** ${sessionId}`,
            '',
            'Please investigate manually or re-comment `/fix` to retry.',
            '',
          ].join('\n'),
        )
      }
    })

    it('puts details before the run line and skips an empty session and closing', () => {
      const result = run({
        ...failure,
        STATUS: 'failed',
        SESSION_ID: '',
        CLOSING: '',
        DETAILS: '**PR:** https://github.example/owner/repo/pull/3\n\n',
      })
      expect(result.status).toBe(0)
      expect(result.posted).toBe(
        [
          'issue comment 12 --repo owner/repo --body /fix run failed — auto-fix could not complete.',
          '',
          '**PR:** https://github.example/owner/repo/pull/3',
          `**Auto-fix run:** ${runUrl}`,
          '',
        ].join('\n'),
      )
    })

    it('posts every time because failure comments are not deduplicated', () => {
      const comments = [{ user: { login: 'github-actions[bot]' }, body: marker }]
      expect(run({ ...failure, STATUS: 'failed' }, comments).posted).toContain('issue comment 12')
    })

    it('refuses a bad status, session id, missing text, or run URL', () => {
      const bad: Array<[Record<string, string>, string]> = [
        [{ STATUS: 'done' }, 'status'],
        [{ STATUS: 'failed', SESSION_ID: 'sess-XYZ' }, 'session id'],
        [{ STATUS: 'failed', HEADLINE: '' }, 'headline'],
        [{ STATUS: 'failed', RUN_LABEL: '' }, 'headline'],
        [{ STATUS: 'failed', RUN_URL: 'http://github.example/run' }, 'run URL'],
        [{ STATUS: 'failed', RUN_URL: 'https://a.example/\nhttps://b.example' }, 'run URL'],
        [{ STATUS: 'failed', TARGET: 'x' }, 'non-numeric'],
      ]
      for (const [env, message] of bad) {
        const result = run({ ...failure, ...env })
        expect(result.status).toBe(1)
        expect(result.stdout).toContain(message)
        expect(result.posted).toBe('')
      }
    })
  })
})
