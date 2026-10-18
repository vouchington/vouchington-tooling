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
  for (const n of [1, 2, 3]) {
    writeFileSync(join(origin, 'file'), String(n))
    git(origin, 'add', 'file')
    git(origin, 'commit', '--quiet', '-m', `commit ${n}`)
  }
  const depth = shallow ? ['--depth', '1'] : []
  git(scratch, 'clone', '--quiet', ...depth, `file://${origin}`, work)
  return work
}

function run(cwd: string, baseRef: string) {
  return spawnSync('bash', ['-c', script], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, BASE_REF: baseRef },
  })
}

describe('fetch-base-ref composite action', () => {
  it('is a composite bash action that takes the base ref from the event', () => {
    expect(action.runs.using).toBe('composite')
    expect(fetchStep?.shell).toBe('bash')
    expect(fetchStep?.env?.BASE_REF).toBe(
      "${{ github.base_ref || github.event.repository.default_branch || 'main' }}",
    )
    expect(script).not.toContain('${{')
    expect(source).not.toMatch(/vouchington|voucha/iu)
  })

  it('unshallows a shallow clone and creates the origin/<base> ref', () => {
    const work = clone('shallow', true)
    expect(git(work, 'rev-parse', '--is-shallow-repository')).toBe('true')
    expect(run(work, 'main').status).toBe(0)
    expect(git(work, 'rev-parse', '--is-shallow-repository')).toBe('false')
    expect(git(work, 'rev-list', '--count', 'refs/remotes/origin/main')).toBe('3')
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
