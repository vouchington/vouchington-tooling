import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Answers `gh repo view` and `gh pr list --head <branch>` from files, like the real CLI.
const FAKE_GH = `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
const env = process.env
if (env.FAKE_GH_FAIL) process.exit(1)
if (args[0] === 'repo') {
  console.log(JSON.stringify({ nameWithOwner: env.GH_REPO || 'Acme/Widgets' }))
  process.exit(0)
}
if (env.FAKE_GH_GARBAGE) {
  console.log('not json')
  process.exit(0)
}
// Simulates a change that lands between the first assessment and the re-check.
if (env.FAKE_GH_TOUCH) fs.writeFileSync(env.FAKE_GH_TOUCH, 'x')
if (env.FAKE_GH_ADVANCE) {
  const { execFileSync } = require('node:child_process')
  const opts = { cwd: env.FAKE_GH_ADVANCE, stdio: 'ignore' }
  execFileSync('git', ['commit', '--allow-empty', '-m', 'late'], opts)
  execFileSync('git', ['push', 'origin', 'HEAD'], opts)
}
const branch = args[args.indexOf('--head') + 1]
const file = env.FAKE_GH_DIR + '/' + branch.replaceAll('/', '_') + '.json'
console.log(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '[]')
`

export interface Fixture {
  readonly root: string
  readonly main: string
  readonly caller: string
  readonly env: NodeJS.ProcessEnv
  git(cwd: string, ...args: string[]): string
  /** Adds a worktree on a new branch with one commit; optionally pushes it to origin. */
  addWorktree(name: string, options?: { push?: boolean }): string
  /** Writes the fake `gh pr list` answer; a PR with no head defaults to the branch tip. */
  setPrs(branch: string, prs: object[]): void
  cleanup(): void
}

const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()

export function createFixture(): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'worktree-reclaim-')))
  const bin = join(root, 'bin')
  const ghDir = join(root, 'gh')
  mkdirSync(bin)
  mkdirSync(ghDir)
  writeFileSync(join(bin, 'gh'), FAKE_GH)
  chmodSync(join(bin, 'gh'), 0o755)
  // A git wrapper that fails any invocation containing the words in FAKE_GIT_FAIL, to reach error paths.
  writeFileSync(
    join(bin, 'git'),
    `#!/bin/sh\ncase " $* " in *" $FAKE_GIT_FAIL "*) [ -n "$FAKE_GIT_FAIL" ] && exit 1;; esac\nexec '${realGit}' "$@"\n`,
  )
  chmodSync(join(bin, 'git'), 0o755)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    FAKE_GH_DIR: ghDir,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  }
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const origin = join(root, 'origin.git')
  const main = join(root, 'main')
  git(root, 'init', '--bare', '-b', 'main', origin)
  git(root, 'init', '-b', 'main', main)
  writeFileSync(join(main, 'README.md'), 'base\n')
  git(main, 'add', '.')
  git(main, 'commit', '-m', 'base')
  git(main, 'remote', 'add', 'origin', origin)
  git(main, 'push', '-u', 'origin', 'main')
  const caller = join(root, 'worktrees', 'caller')
  git(main, 'worktree', 'add', '-b', 'caller', caller)
  return {
    root,
    main,
    caller,
    env,
    git,
    addWorktree: (name, options = {}) => {
      const path = join(root, 'worktrees', name)
      git(main, 'worktree', 'add', '-b', name, path)
      writeFileSync(join(path, `${name}.txt`), `${name}\n`)
      git(path, 'add', '.')
      git(path, 'commit', '-m', name)
      if (options.push) git(path, 'push', '-u', 'origin', name)
      return path
    },
    setPrs: (branch, prs) => {
      const tip = git(main, 'rev-parse', `refs/heads/${branch}`).trim()
      const filled = prs.map((pr) => ({
        headRefOid: tip,
        isCrossRepository: false,
        headRepository: { name: 'Widgets' },
        headRepositoryOwner: { login: 'acme' },
        ...pr,
      }))
      writeFileSync(join(ghDir, `${branch.replaceAll('/', '_')}.json`), JSON.stringify(filled))
    },
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  }
}
