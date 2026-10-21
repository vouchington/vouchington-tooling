import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const script = resolve('packages/vouchington-tooling/scripts/worktree/git-worktrees.sh')
const lockScript = resolve('packages/vouchington-tooling/scripts/worktree/git-index-lock.sh')
const testDirs: string[] = []

async function source(command: string, args: string[] = []) {
  return execFileAsync('bash', ['-c', 'source "$1"; shift; ' + command, 'bash', script, ...args])
}

describe('git-worktrees.sh', () => {
  afterEach(async () => {
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('hashes a physical path with the stable d-prefixed SHA-256 identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'worktree-library-'))
    const alias = `${root}-alias`
    testDirs.push(root, alias)
    await symlink(root, alias)

    const { stdout } = await source('git_worktree_canonical_path_hash "$1"', [alias])

    const expected = `d${createHash('sha256')
      .update(await realpath(root))
      .digest('hex')
      .slice(0, 12)}`
    expect(stdout.trim()).toBe(expected)
  })

  it('fails when the path cannot be canonicalized', async () => {
    await expect(
      source('git_worktree_canonical_path_hash "$1"', ['/definitely/not/a/worktree']),
    ).rejects.toMatchObject({ code: 1 })
  })

  it('propagates Git worktree discovery failures', async () => {
    const missing = '/definitely/not/a/repository'
    await expect(source('git_worktree_list_porcelain "$1"', [missing])).rejects.toMatchObject({
      code: 128,
      stderr: expect.stringMatching(/fatal:/),
    })
    for (const query of [
      'git_worktree_live_paths "$1"',
      'git_worktree_prunable_paths "$1"',
      'git_worktree_main_path "$1"',
      'git_worktree_path_is_registered "$1" "$1"',
    ]) {
      await expect(source(query, [missing])).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringMatching(/fatal:/),
      })
    }
  })

  it('fails the main path lookup when git lists no worktree', async () => {
    await expect(
      execFileAsync('bash', [
        '-c',
        'source "$1"; git() { return 0; }; git_worktree_main_path',
        'bash',
        script,
      ]),
    ).rejects.toMatchObject({ code: 1 })
  })

  it('parses live and prunable paths from git porcelain output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'worktree-library-'))
    const live = join(root, 'live')
    const stale = join(root, 'stale')
    testDirs.push(root)
    await mkdir(live)
    const porcelain = [
      `worktree ${root}`,
      'HEAD 111',
      '',
      `worktree ${live}`,
      'HEAD 222',
      '',
      `worktree ${stale}`,
      'HEAD 333',
      'prunable',
      '',
    ].join('\n')
    const command = `
      git() { printf '%s' "$PORCELAIN"; }
      git_worktree_live_paths "$1"
      git_worktree_prunable_paths "$1"
      printf 'main=%s\\n' "$(git_worktree_main_path "$1")"
      if git_worktree_path_is_registered "$1" "$2"; then
        printf 'registered=yes\\n'
      fi
      if ! git_worktree_path_is_registered "$1" "$3"; then
        printf 'missing=yes\\n'
      fi
      printf 'display=%s\\n' "$(worktree_dir_from_path '/a/worktrees/one/two')"
    `

    const { stdout } = await execFileAsync(
      'bash',
      ['-c', `source "$1"; shift; ${command}`, 'bash', script, root, live, `${live}-missing`],
      {
        env: { ...process.env, PORCELAIN: porcelain },
      },
    )

    expect(stdout.trim().split('\n')).toEqual([
      root,
      live,
      stale,
      `main=${root}`,
      'registered=yes',
      'missing=yes',
      'display=one/two',
    ])
  })
})

describe('git-index-lock.sh', () => {
  afterEach(async () => {
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  async function clear(gitDir: string) {
    return execFileAsync('bash', [
      '-c',
      'source "$1"; clear_stale_index_lock "$2"',
      'bash',
      lockScript,
      gitDir,
    ])
  }

  it('removes only a 0-byte index.lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'index-lock-'))
    testDirs.push(root)
    const lock = join(root, 'index.lock')
    await writeFile(lock, '')
    const sourceText = await readFile(lockScript, 'utf8')

    const { stdout } = await clear(root)

    expect(stdout).toContain(`Cleared stale empty index.lock at ${root}/index.lock`)
    await expect(access(lock)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(sourceText).not.toMatch(/YELLOW|NC|voucha|docs\/development/)
  })

  it('leaves a non-empty index.lock in place', async () => {
    const root = await mkdtemp(join(tmpdir(), 'index-lock-'))
    testDirs.push(root)
    const lock = join(root, 'index.lock')
    await writeFile(lock, 'real-lock-content')

    const { stdout } = await clear(root)

    expect(stdout).toBe('')
    expect(await readFile(lock, 'utf8')).toBe('real-lock-content')
  })

  it('does nothing when index.lock is absent and rejects an empty directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'index-lock-'))
    testDirs.push(root)

    const { stdout } = await clear(root)
    expect(stdout).toBe('')
    await expect(access(join(root, 'index.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(clear('')).rejects.toMatchObject({ code: 1 })
  })
})
