import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EvalCase } from './cases.mts'
import { CONTEXT_DIR, defaultExec, prepareSnapshot, type Exec } from './snapshot.mts'

const item: EvalCase = {
  id: 'case-1',
  repo: 'acme/widgets',
  pr: 9,
  title: 'My title',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  kind: 'negative',
  reason: '',
  expected: [],
}

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'snapshot-test-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function fakeExec(calls: Array<[string, string[]]>): Exec {
  return async (command, args) => {
    calls.push([command, args])
    if (command === 'git' && args.includes('archive')) {
      writeFileSync(args[args.indexOf('-o') + 1] as string, 'tar')
      return ''
    }
    if (command === 'tar') {
      mkdirSync(join(args[args.indexOf('-C') + 1] as string, 'src'), { recursive: true })
      writeFileSync(join(args[args.indexOf('-C') + 1] as string, 'src', 'a.ts'), 'x')
      return ''
    }
    if (command === 'git' && args.includes('diff')) return 'DIFF'
    if (command === 'gh' && args[0] === 'pr') return '  PR body \n'
    return ''
  }
}

describe('prepareSnapshot', () => {
  it('clones once, exports a git-free tree, and writes context files', async () => {
    const calls: Array<[string, string[]]> = []
    const cache = join(root, 'cache')
    const work = join(root, 'work')
    const snapshot = await prepareSnapshot(item, cache, work, fakeExec(calls))
    const repoDir = join(cache, 'acme__widgets')
    expect(snapshot).toEqual({
      dir: join(work, 'case-1', 'tree'),
      diff: 'DIFF',
      body: '  PR body \n',
    })
    expect(calls.map(([command, args]) => [command, args[0]])).toEqual([
      ['gh', 'repo'],
      ['git', '-C'],
      ['git', '-C'],
      ['tar', '-xf'],
      ['git', '-C'],
      ['gh', 'pr'],
    ])
    expect(calls[0]?.[1].slice(0, 4)).toEqual(['repo', 'clone', 'acme/widgets', repoDir])
    expect(calls[1]?.[1]).toContain('fetch')
    expect(readFileSync(join(snapshot.dir, 'src', 'a.ts'), 'utf8')).toBe('x')
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'diff.patch'), 'utf8')).toBe('DIFF')
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'pr.md'), 'utf8')).toBe(
      '# My title\n\nPR body\n',
    )
    expect(calls.at(-2)?.[1]).toContain(`${item.baseSha}...${item.headSha}`)
  })

  it('reuses an existing clone and clears stale work directories', async () => {
    const cache = join(root, 'cache')
    const work = join(root, 'work')
    mkdirSync(join(cache, 'acme__widgets', '.git'), { recursive: true })
    mkdirSync(join(work, 'case-1', 'tree'), { recursive: true })
    writeFileSync(join(work, 'case-1', 'tree', 'stale.txt'), 'old')
    const calls: Array<[string, string[]]> = []
    const snapshot = await prepareSnapshot(item, cache, work, fakeExec(calls))
    expect(calls.some(([command, args]) => command === 'gh' && args[0] === 'repo')).toBe(false)
    expect(() => readFileSync(join(snapshot.dir, 'stale.txt'))).toThrow()
  })

  it('uses the default exec and surfaces its failures when no binaries exist', async () => {
    const cache = join(root, 'cache')
    const empty = join(root, 'empty-bin')
    mkdirSync(empty)
    mkdirSync(join(cache, 'acme__widgets', '.git'), { recursive: true })
    vi.stubEnv('PATH', empty)
    try {
      await expect(prepareSnapshot(item, cache, join(root, 'work'))).rejects.toThrow()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('defaultExec', () => {
  it('returns stdout and honors cwd', async () => {
    await expect(defaultExec(process.execPath, ['-p', '1+1'])).resolves.toBe('2\n')
    await expect(
      defaultExec(process.execPath, ['-p', 'process.cwd()'], { cwd: root }),
    ).resolves.toContain('snapshot-test-')
  })

  it('rejects on a non-zero exit', async () => {
    const script = "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"
    const failure = defaultExec(process.execPath, ['-e', script, 'SECRET-ARG'])
    await expect(failure).rejects.toThrow(`${process.execPath} exited with 3\nout\nerr`)
    await expect(failure).rejects.not.toThrow('SECRET-ARG')
    await expect(defaultExec(process.execPath, ['-e', 'process.exit(4)'])).rejects.toThrow(
      /exited with 4$/u,
    )
    await expect(defaultExec('final-review-missing-binary', [])).rejects.toThrow(
      'final-review-missing-binary exited with ENOENT',
    )
  })
})
