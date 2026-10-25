import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { afterAll, describe, expect, it } from 'vitest'

type Step = { shell?: string; env?: Record<string, string>; run?: string }
type Action = {
  inputs: Record<string, { default?: string; required?: boolean }>
  outputs: Record<string, { value: string }>
  runs: { using: string; steps: Step[] }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const source = readFileSync(join(root, '.github/actions/comment-command-parse/action.yml'), 'utf8')
const action = load(source) as Action
const script = action.runs.steps[0]?.run ?? ''
const writer = join(
  root,
  'packages/vouchington-tooling/scripts/gha/write-github-multiline-output.sh',
)
const scratch = mkdtempSync(join(tmpdir(), 'comment-command-parse-'))
let counter = 0

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

// Reads the last value written for each output, honouring the multiline delimiter syntax.
function parseOutputs(text: string) {
  const outputs: Record<string, string> = {}
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const multiline = /^([A-Za-z_][A-Za-z0-9_-]*)<<(.+)$/u.exec(line)
    if (multiline) {
      const end = lines.indexOf(multiline[2] ?? '', index + 1)
      outputs[multiline[1] ?? ''] = lines.slice(index + 1, end).join('\n')
      index = end
    } else if (line.includes('=')) {
      const at = line.indexOf('=')
      outputs[line.slice(0, at)] = line.slice(at + 1)
    }
  }
  return outputs
}

function run(env: Record<string, string>) {
  counter += 1
  const dir = join(scratch, `run-${counter}`)
  mkdirSync(dir, { recursive: true })
  const outputFile = join(dir, 'output')
  writeFileSync(outputFile, '')
  // `gh api repos/.../pulls/N --jq .title` answers with the title from PR_TITLE_FIXTURE.
  writeFileSync(join(dir, 'gh'), '#!/usr/bin/env bash\nprintf \'%s\\n\' "$PR_TITLE_FIXTURE"\n')
  chmodSync(join(dir, 'gh'), 0o755)
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      TMPDIR: dir,
      GITHUB_OUTPUT: outputFile,
      GITHUB_REPOSITORY: 'owner/repo',
      WRITE_OUTPUT: writer,
      PARSE_MODE: 'first-line',
      PR_NUMBER: '',
      GH_TOKEN: 'token',
      ...env,
    },
  })
  return { ...result, outputs: parseOutputs(readFileSync(outputFile, 'utf8')) }
}

type Case = [name: string, command: string, body: string, accepted: boolean, request: string]

// Every case mirrors the awk and sed behaviour of the original first-line workflow blocks.
const firstLine: Case[] = [
  ['bare command', '/fix', '/fix', true, ''],
  ['bare command with a trailing newline', '/fix', '/fix\n', true, ''],
  [
    'request on the following lines',
    '/fix',
    '/fix\nrepair the build\nsecond line',
    true,
    'repair the build\nsecond line',
  ],
  [
    'request keeps blank lines and indentation',
    '/fix',
    '/fix\n\n  keep me\n\nend',
    true,
    '\n  keep me\n\nend',
  ],
  ['surrounding whitespace on the command line', '/fix', '  \t/fix \t \nrequest', true, 'request'],
  ['CRLF line endings', '/fix', '/fix\r\nrequest\r\nmore', true, 'request\r\nmore'],
  ['text after the command on the first line', '/fix', '/fix please\nrequest', false, ''],
  ['command not on the first line', '/fix', 'intro\n/fix\nrequest', false, ''],
  ['leading blank line', '/fix', '\n/fix\nrequest', false, ''],
  ['different command', '/fix', '/plan\nrequest', false, ''],
  ['command prefix of a longer word', '/fix', '/fixes\nrequest', false, ''],
  ['command embedded in a word', '/fix', 'a/fix\nrequest', false, ''],
  ['command in a code fence', '/fix', '```\n/fix\n```\nrequest', false, ''],
  ['uppercase command', '/fix', '/FIX\nrequest', false, ''],
  ['empty comment', '/fix', '', false, ''],
  ['whitespace-only comment', '/fix', '  \n  ', false, ''],
  ['plan token', '/plan', '/plan\ndesign the cache', true, 'design the cache'],
  ['plan token ignores fix', '/plan', '/fix\ndesign the cache', false, ''],
  ['token with regex characters is literal', '/p-l_a2', '/p-l_a2\nbody', true, 'body'],
  [
    'a later copy of the command stays in the request',
    '/fix',
    '/fix\nsee /fix again',
    true,
    'see /fix again',
  ],
  ['unicode request', '/fix', '/fix\nrépare 🚀', true, 'répare 🚀'],
  [
    'shell metacharacters stay literal',
    '/fix',
    '/fix\n$(touch pwned) `id` "q" \'s\' ${HOME}',
    true,
    '$(touch pwned) `id` "q" \'s\' ${HOME}',
  ],
  ['output delimiter lookalike', '/fix', '/fix\nREQUEST_0\nEOF', true, 'REQUEST_0\nEOF'],
]

const wholeBody: Case[] = [
  ['bare command', '/shepherd', '/shepherd', true, ''],
  ['surrounding whitespace', '/shepherd', '  \t/shepherd \t', true, ''],
  ['trailing blank lines', '/shepherd', '/shepherd\n\n  \n', true, ''],
  ['CRLF', '/shepherd', '/shepherd\r\n', true, ''],
  ['leading blank line', '/shepherd', '\n/shepherd', false, ''],
  ['request text on a later line', '/shepherd', '/shepherd\nfocus on tests', false, ''],
  ['request text on the same line', '/shepherd', '/shepherd now', false, ''],
  ['text before the command', '/shepherd', 'please /shepherd', false, ''],
  ['command in a code fence', '/shepherd', '```\n/shepherd\n```', false, ''],
  ['uppercase command', '/shepherd', '/Shepherd', false, ''],
  ['empty comment', '/shepherd', '', false, ''],
  ['different command', '/shepherd', '/fix', false, ''],
]

describe('comment-command-parse action', () => {
  it('is a composite action that passes every input through env', () => {
    expect(action.runs.using).toBe('composite')
    expect(action.inputs.command?.required).toBe(true)
    expect(action.inputs['comment-body']?.default).toBe('${{ github.event.comment.body }}')
    expect(action.inputs.mode?.default).toBe('first-line')
    expect(Object.keys(action.outputs)).toEqual(['accepted', 'request', 'pr-title'])
    const [step] = action.runs.steps
    expect(step?.shell).toBe('bash')
    expect(step?.env).toMatchObject({
      COMMAND_TOKEN: '${{ inputs.command }}',
      COMMENT_BODY: '${{ inputs.comment-body }}',
      PARSE_MODE: '${{ inputs.mode }}',
      PR_NUMBER: '${{ inputs.pr-number }}',
      GH_TOKEN: '${{ inputs.github-token }}',
    })
    expect(script).not.toContain('${{')
    expect(source.replace('packages/vouchington-tooling/', '')).not.toMatch(/vouchington|voucha/iu)
  })

  describe.each([
    ['first-line', firstLine],
    ['whole-body', wholeBody],
  ] as const)('%s mode', (mode, cases) => {
    it.each(cases)('%s', (_name, command, body, accepted, request) => {
      const result = run({ COMMAND_TOKEN: command, COMMENT_BODY: body, PARSE_MODE: mode })
      expect(result.status).toBe(0)
      expect(result.outputs.accepted).toBe(String(accepted))
      expect(result.outputs.request).toBe(accepted ? request : undefined)
      expect(result.outputs['pr-title']).toBeUndefined()
      if (!accepted) expect(result.stdout).toContain(`not the standalone ${command} command`)
      expect(result.stderr).toBe('')
    })
  })

  it('reads the pull request title only for an accepted comment', () => {
    const base = { COMMAND_TOKEN: '/shepherd', PARSE_MODE: 'whole-body', PR_NUMBER: '7' }
    const title = 'feat: add thing\nwith $(odd) "title"'
    const accepted = run({ ...base, COMMENT_BODY: '/shepherd', PR_TITLE_FIXTURE: title })
    expect(accepted.status).toBe(0)
    expect(accepted.outputs).toEqual({ accepted: 'true', request: '', 'pr-title': title })
    const ignored = run({ ...base, COMMENT_BODY: 'hello', PR_TITLE_FIXTURE: title })
    expect(ignored.outputs).toEqual({ accepted: 'false' })
  })

  it('refuses invalid inputs before reading the comment', () => {
    const bad: Array<[Record<string, string>, string]> = [
      [{ COMMAND_TOKEN: 'fix' }, 'command must be'],
      [{ COMMAND_TOKEN: '/' }, 'command must be'],
      [{ COMMAND_TOKEN: '/a b' }, 'command must be'],
      [{ COMMAND_TOKEN: '/fix\n/plan' }, 'command must be'],
      [{ COMMAND_TOKEN: '/fix', PARSE_MODE: 'any' }, 'mode must be'],
      [{ COMMAND_TOKEN: '/fix', PR_NUMBER: 'abc' }, 'pr-number must be'],
      [{ COMMAND_TOKEN: '/fix', PR_NUMBER: '0' }, 'pr-number must be'],
    ]
    for (const [env, message] of bad) {
      const result = run({ COMMENT_BODY: '/fix', ...env })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain(message)
      expect(result.outputs).toEqual({})
    }
  })
})
