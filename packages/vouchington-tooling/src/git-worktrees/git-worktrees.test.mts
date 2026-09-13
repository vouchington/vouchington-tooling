import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const script = resolve('packages/vouchington-tooling/scripts/worktree/git-worktrees.sh')
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
