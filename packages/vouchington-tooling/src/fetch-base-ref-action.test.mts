import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { afterAll, describe, expect, it } from 'vitest'

const path = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  '.github/actions/fetch-base-ref/action.yml',
)
const source = readFileSync(path, 'utf8')
const action = load(source) as {
  runs: {
    using: string
    steps: Array<{ shell?: string; env?: Record<string, string>; run?: string }>
  }
  inputs: Record<string, { default?: string; required?: boolean }>
}
const [fetchStep] = action.runs.steps
const script = fetchStep?.run ?? ''
const scratch = mkdtempSync(join(tmpdir(), 'fetch-base-ref-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

// An origin with three commits on main, cloned either shallowly or in full.
function clone(name: string, shallow: boolean) {
  const origin = join(scratch, `${name}-origin`)
  const work = join(scratch, `${name}-work`)
  git(scratch, 'init', '--quiet', '--initial-branch=main', origin)
  git(origin, 'config', 'user.email', 'test@example.com')
  git(origin, 'config', 'user.name', 'Test')
  git(origin, 'config', 'commit.gpgsign', 'false')
  git(origin, 'config', 'uploadpack.allowFilter', 'true')
  git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
  for (const n of [1, 2, 3]) {
    writeFileSync(join(origin, 'file'), String(n))
    git(origin, 'add', 'file')
    git(origin, 'commit', '--quiet', '-m', `commit ${n}`)
  }
  const depth = shallow ? ['--depth', '1'] : []
  git(scratch, 'clone', '--quiet', ...depth, `file://${origin}`, work)
  return work
}

function run(cwd: string, baseRef: string, filter = '') {
  return spawnSync('bash', ['-c', script], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, BASE_REF: baseRef, FILTER: filter },
  })
}

describe('fetch-base-ref composite action', () => {
  it('is a composite bash action that takes the base ref from the event', () => {
    expect(action.runs.using).toBe('composite')
    expect(fetchStep?.shell).toBe('bash')
    expect(fetchStep?.env?.BASE_REF).toBe(
      "${{ github.base_ref || github.event.repository.default_branch || 'main' }}",
    )
    expect(fetchStep?.env?.FILTER).toBe('${{ inputs.filter }}')
    expect(action.inputs.filter).toEqual({
      description: expect.any(String),
      required: false,
      default: '',
    })
    expect(script).not.toContain('${{')
    expect(source).not.toMatch(/vouchington|voucha/iu)
  })

  it('deepens a shallow clone and creates the origin/<base> and ci-head refs', () => {
    const work = clone('shallow', true)
    expect(git(work, 'rev-parse', '--is-shallow-repository')).toBe('true')
    expect(run(work, 'main').status).toBe(0)
    expect(git(work, 'rev-parse', '--is-shallow-repository')).toBe('false')
    expect(git(work, 'rev-list', '--count', 'refs/remotes/origin/main')).toBe('3')
    expect(git(work, 'rev-parse', 'refs/remotes/origin/ci-head')).toBe(
      git(work, 'rev-parse', 'HEAD'),
    )
  })

  it('fetches only the base branch and HEAD, not other branches', () => {
    const work = clone('scoped', false)
    git(join(scratch, 'scoped-origin'), 'branch', 'other')
    expect(run(work, 'main').status).toBe(0)
    expect(git(work, 'for-each-ref', '--format=%(refname)', 'refs/remotes/origin')).toBe(
      'refs/remotes/origin/HEAD\nrefs/remotes/origin/ci-head\nrefs/remotes/origin/main',
    )
  })

  it('passes the filter input as a partial-clone filter only when set', () => {
    const plain = clone('plain', false)
    expect(run(plain, 'main').status).toBe(0)
    const unset = spawnSync('git', ['config', 'remote.origin.partialclonefilter'], { cwd: plain })
    expect(unset.status).toBe(1)
    const filtered = clone('filtered', false)
    expect(run(filtered, 'main', 'blob:none').status).toBe(0)
    expect(git(filtered, 'config', 'remote.origin.partialclonefilter')).toBe('blob:none')
  })

  it('skips the unshallow for a complete clone', () => {
    const work = clone('full', false)
    expect(run(work, 'main').status).toBe(0)
    expect(git(work, 'rev-parse', '--verify', 'refs/remotes/origin/main')).toMatch(/^[0-9a-f]{40}$/)
  })

  it('fails when the base branch does not exist', () => {
    const work = clone('missing', false)
    expect(run(work, 'no-such-branch').status).not.toBe(0)
  })
})
