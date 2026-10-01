import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gha/gha-collaborator-trust.sh',
)
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

// The stub records each call and answers from a login -> permission table. "404" and "500"
// simulate API failures the way `gh api` reports them: on stderr with a non-zero exit.
function runTrust(args: string[], stdin: string) {
  const root = mkdtempSync(join(tmpdir(), 'gha-collaborator-trust-'))
  temporaryDirectories.push(root)
  writeFileSync(
    join(root, 'gh'),
    `#!/bin/sh
echo "$*" >> "${join(root, 'calls.log')}"
case "$2" in
  */collaborators/alice/permission) echo admin ;;
  */collaborators/bob/permission) echo write ;;
  */collaborators/carol/permission) echo read ;;
  */collaborators/ghost/permission) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
  */collaborators/flaky/permission) echo 'gh: Server Error (HTTP 500)' >&2; exit 1 ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`,
  )
  chmodSync(join(root, 'gh'), 0o755)
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    input: stdin,
    env: { ...process.env, PATH: `${root}:${process.env.PATH ?? ''}` },
  })
  let calls: string[] = []
  try {
    calls = readFileSync(join(root, 'calls.log'), 'utf8').trim().split('\n')
  } catch {
    calls = []
  }
  return { ...result, calls }
}

const user = (login: string) => ({ login, type: 'User' })

describe('gha-collaborator-trust', () => {
  it('trusts admin and write collaborators and installed app bots', () => {
    const result = runTrust(
      ['owner/repo'],
      JSON.stringify([
        user('carol'),
        user('alice'),
        { login: 'github-actions[bot]', type: 'Bot' },
        user('bob'),
        user('ghost'),
        user('alice'),
      ]),
    )
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      trusted: ['alice', 'bob', 'github-actions[bot]'],
      untrusted: ['carol', 'ghost'],
    })
    expect(result.calls).toEqual([
      'api repos/owner/repo/collaborators/alice/permission --jq .permission',
      'api repos/owner/repo/collaborators/bob/permission --jq .permission',
      'api repos/owner/repo/collaborators/carol/permission --jq .permission',
      'api repos/owner/repo/collaborators/ghost/permission --jq .permission',
    ])
  })

  it('accepts full GitHub user objects and an empty list', () => {
    const full = runTrust(['owner/repo'], JSON.stringify([{ login: 'bob', type: 'User', id: 2 }]))
    expect(JSON.parse(full.stdout)).toEqual({ trusted: ['bob'], untrusted: [] })
    const empty = runTrust(['owner/repo'], '[]')
    expect(empty.status).toBe(0)
    expect(JSON.parse(empty.stdout)).toEqual({ trusted: [], untrusted: [] })
    expect(empty.calls).toEqual([])
  })

  it('fails closed when a lookup fails for any reason other than 404', () => {
    const result = runTrust(['owner/repo'], JSON.stringify([user('alice'), user('flaky')]))
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('permission lookup failed for flaky')
  })

  it('never looks up a login that is not a plain GitHub username', () => {
    const result = runTrust(['owner/repo'], JSON.stringify([user('../../user'), user('a b')]))
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ trusted: [], untrusted: ['../../user', 'a b'] })
    expect(result.calls).toEqual([])
  })

  it('rejects bad arguments and malformed input', () => {
    expect(runTrust([], '[]').status).toBe(2)
    expect(runTrust(['../etc'], '[]').status).toBe(2)
    expect(runTrust(['owner/repo', 'extra'], '[]').status).toBe(2)
    expect(runTrust(['owner/repo'], '{}').status).toBe(2)
    expect(runTrust(['owner/repo'], '[{"type":"User"}]').status).toBe(2)
    expect(runTrust(['owner/repo'], 'not json').status).toBe(2)
  })
})
