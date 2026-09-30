import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitEnv } from '../shared-context/index.mts'

export type RepoFixture = {
  /** Real path of the directory holding every repository below. */
  root: string
  /** The primary worktree of the launch repository. */
  main: string
  /** A linked worktree of the launch repository. */
  linked: string
  /** A separate repository created with `git init`. */
  outside: string
  /** A symlink that points at `linked`. */
  alias: string
  git: (cwd: string, ...args: string[]) => string
  cleanup: () => void
}

const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.test']

/** Two real repositories under the OS tmpdir: one with a linked worktree, one unrelated. */
export function createRepoFixture(): RepoFixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'vouchington-mcp-')))
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', [...IDENTITY, '-C', cwd, ...args], {
      encoding: 'utf8',
      env: gitEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  const main = join(root, 'main')
  const linked = join(root, 'linked')
  const outside = join(root, 'outside')
  const alias = join(root, 'alias')
  mkdirSync(main)
  git(main, 'init', '--quiet')
  git(main, 'commit', '--quiet', '--allow-empty', '-m', 'initial')
  git(main, 'worktree', 'add', '--quiet', '-b', 'linked', linked)
  mkdirSync(outside)
  git(outside, 'init', '--quiet')
  symlinkSync(linked, alias)
  return {
    root,
    main,
    linked,
    outside,
    alias,
    git,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}
