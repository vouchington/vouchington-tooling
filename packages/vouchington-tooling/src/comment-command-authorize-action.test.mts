import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Action = {
  inputs: Record<string, { required?: boolean; default?: string }>
  outputs: Record<string, { value: string }>
  runs: {
    using: string
    steps: Array<{ shell?: string; env?: Record<string, string>; run?: string }>
  }
}

const path = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  '.github/actions/comment-command-authorize/action.yml',
)
const source = readFileSync(path, 'utf8')
const action = load(source) as Action
const script = action.runs.steps[0]?.run ?? ''

const comment = (association: string, overrides: Record<string, unknown> = {}) => ({
  id: 77,
  issue_url: 'https://api.github.com/repos/owner/repo/issues/12',
  author_association: association,
  ...overrides,
})

// A stub `gh api` that prints a canned comment (or fails), with the real jq doing the filtering.
function run(env: Record<string, string>, fetched?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'comment-authorize-'))
  const output = join(dir, 'output')
  const stub =
    fetched === undefined
      ? '#!/usr/bin/env bash\necho "gh must not be called" >&2\nexit 9'
      : `#!/usr/bin/env bash\ncat ${JSON.stringify(join(dir, 'comment.json'))}`
  writeFileSync(join(dir, 'gh'), stub)
  chmodSync(join(dir, 'gh'), 0o755)
  writeFileSync(join(dir, 'comment.json'), JSON.stringify(fetched ?? {}))
  writeFileSync(output, '')
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_OUTPUT: output,
      MODE: 'check',
      ALLOWED_ASSOCIATIONS: 'OWNER,COLLABORATOR,MEMBER',
      EVENT_ASSOCIATION: 'OWNER',
      COMMENT_ID: '77',
      ISSUE_NUMBER: '12',
      ...env,
    },
  })
  const outputs = Object.fromEntries(
    readFileSync(output, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('=') as [string, string]),
  )
  return { ...result, outputs }
}

describe('comment-command-authorize action', () => {
  it('is a composite action that passes every input through env', () => {
    expect(action.runs.using).toBe('composite')
    expect(action.inputs['mode']?.default).toBe('check')
    expect(action.inputs['allowed-associations']?.default).toBe('OWNER,COLLABORATOR,MEMBER')
    expect(action.inputs['comment-id']?.default).toBe('${{ github.event.comment.id }}')
    expect(action.inputs['token']?.default).toBe('${{ github.token }}')
    expect(Object.keys(action.outputs)).toEqual(['authorized', 'association'])
    expect(action.runs.steps[0]?.shell).toBe('bash')
    expect(action.runs.steps[0]?.env).toMatchObject({
      GH_TOKEN: '${{ inputs.token }}',
      MODE: '${{ inputs.mode }}',
      ALLOWED_ASSOCIATIONS: '${{ inputs.allowed-associations }}',
      COMMENT_ID: '${{ inputs.comment-id }}',
    })
    expect(script).not.toContain('${{')
    expect(source).not.toMatch(/vouchington|voucha/iu)
  })

  it('check mode authorizes the default associations without calling gh', () => {
    for (const association of ['OWNER', 'COLLABORATOR', 'MEMBER']) {
      const result = run({ EVENT_ASSOCIATION: association })
      expect(result.status).toBe(0)
      expect(result.outputs).toEqual({ authorized: 'true', association })
    }
  })

  it('check mode outputs false and succeeds for other associations', () => {
    for (const association of ['CONTRIBUTOR', 'NONE', 'FIRST_TIMER', '']) {
      const result = run({ EVENT_ASSOCIATION: association })
      expect(result.status).toBe(0)
      expect(result.outputs).toEqual({ authorized: 'false', association })
    }
  })

  it('honors a custom allowed list, trimming spaces and ignoring empty entries', () => {
    const allowed = { ALLOWED_ASSOCIATIONS: ' OWNER, ,CONTRIBUTOR ' }
    expect(run({ ...allowed, EVENT_ASSOCIATION: 'CONTRIBUTOR' }).outputs.authorized).toBe('true')
    expect(run({ ...allowed, EVENT_ASSOCIATION: 'MEMBER' }).outputs.authorized).toBe('false')
    expect(run({ ALLOWED_ASSOCIATIONS: ',', EVENT_ASSOCIATION: '' }).outputs.authorized).toBe(
      'false',
    )
  })

  it('revalidate mode authorizes a comment that still qualifies', () => {
    const result = run({ MODE: 'revalidate', EVENT_ASSOCIATION: 'NONE' }, comment('MEMBER'))
    expect(result.status).toBe(0)
    expect(result.outputs).toEqual({ authorized: 'true', association: 'MEMBER' })
  })

  it('revalidate mode fails when the fetched author is no longer authorized', () => {
    const result = run({ MODE: 'revalidate' }, comment('NONE'))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('no longer an authorized command (association: NONE)')
    expect(result.outputs).toEqual({ authorized: 'false', association: 'NONE' })
  })

  it('revalidate mode fails for a different comment id or another issue', () => {
    const wrongId = run({ MODE: 'revalidate' }, comment('OWNER', { id: 78 }))
    expect(wrongId.status).toBe(1)
    expect(wrongId.outputs.authorized).toBe('false')
    const otherIssue = run(
      { MODE: 'revalidate' },
      comment('OWNER', { issue_url: 'https://api.github.com/repos/owner/repo/issues/112' }),
    )
    expect(otherIssue.status).toBe(1)
    expect(otherIssue.outputs.authorized).toBe('false')
  })

  it('revalidate mode reports none when the comment has no association', () => {
    const result = run({ MODE: 'revalidate' }, comment('', { author_association: null }))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('association: none')
  })

  it('refuses non-numeric ids and unknown modes before calling gh', () => {
    for (const env of [
      { MODE: 'revalidate', COMMENT_ID: 'abc' },
      { MODE: 'revalidate', ISSUE_NUMBER: '0' },
    ]) {
      const result = run(env)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('non-numeric')
      expect(result.stderr).not.toContain('must not be called')
    }
    const mode = run({ MODE: 'other' })
    expect(mode.status).toBe(1)
    expect(mode.stdout).toContain('mode must be check or revalidate')
  })
})
