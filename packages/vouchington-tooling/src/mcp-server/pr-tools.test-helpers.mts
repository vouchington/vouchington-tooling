import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach } from 'vitest'
import type { RepoFixture } from './git-fixture.test-helpers.mts'
import type { GhRunner } from './pr-gh.mts'
import type { PolicyOutcome, PolicyRequest } from './policy-spawn.mts'

export const PR_ARGS = {
  sessionId: 'native:owner',
  title: 'Add the thing',
  summary: 'Adds the thing.',
  impact: 'Nobody breaks.',
  relatedIssues: [{ number: 7, relation: 'closes', reason: 'tracks the work' }],
  details: ['First paragraph.', '- a bullet'],
  base: 'trunk',
  agent: 'codex',
  mode: 'autonomous',
  workspaceSetup: 'fresh worktree',
}

export function declarePolicy(fixture: RepoFixture): void {
  writeFileSync(
    join(fixture.linked, 'package.json'),
    JSON.stringify({ 'vouchington-tooling': { policy: 'policy.mts' } }),
  )
  writeFileSync(join(fixture.linked, 'policy.mts'), '')
}

type Reply = (name: string, input: Record<string, unknown>) => unknown

export function policy(reply: Reply) {
  const requests: Array<{ name: string; input: Record<string, unknown> }> = []
  const spawnPolicy = async (request: PolicyRequest): Promise<PolicyOutcome> => {
    const { export: name, input } = JSON.parse(request.input) as {
      export: string
      input: Record<string, unknown>
    }
    requests.push({ name, input })
    const result = reply(name, input)
    const stdout = result === undefined ? { ok: true, skipped: true } : { ok: true, result }
    return {
      exitCode: 0,
      stdout: JSON.stringify(stdout),
      stderr: '',
      timedOut: false,
      overflowed: false,
    }
  }
  return { requests, spawnPolicy }
}

type GhCall = { args: string[]; cwd: string; env: NodeJS.ProcessEnv; body?: string }

/** A fake gh: records calls (reading any --body-file while it still exists) and replies by verb. */
export function fakeGh(replies: { view?: unknown; create?: string; edit?: string } = {}) {
  const calls: GhCall[] = []
  const bodyFiles: Array<{ path: string; mode: number }> = []
  const runGh: GhRunner = async (args, options) => {
    const call: GhCall = { args, ...options }
    const file = args[args.indexOf('--body-file') + 1]
    if (args.includes('--body-file') && file !== undefined) {
      call.body = readFileSync(file, 'utf8')
      bodyFiles.push({ path: file, mode: statSync(file).mode & 0o777 })
    }
    calls.push(call)
    if (args[1] === 'view') return JSON.stringify(replies.view)
    if (args[1] === 'create') return replies.create ?? 'https://github.com/o/r/pull/12\n'
    return replies.edit ?? 'https://github.com/o/r/pull/5\n'
  }
  return { calls, bodyFiles, runGh }
}

export const device = () => ({ user: 'Jong', host: 'Laptop.Local' })

/** Gives the fixture an `origin` that already has the linked branch at its current commit. */
export function usePushedRemote(fixture: () => RepoFixture): void {
  beforeEach(() => {
    const f = fixture()
    const origin = join(f.root, 'origin.git')
    f.git(f.root, 'init', '--quiet', '--bare', origin)
    f.git(f.linked, 'remote', 'add', 'origin', origin)
    f.git(f.linked, 'push', '--quiet', 'origin', 'linked')
  })
}
