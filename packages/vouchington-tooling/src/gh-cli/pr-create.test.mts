import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import type { RunTextCommand } from './exec.mts'
import {
  assertHeadPushed,
  buildGhPrCreateArgs,
  createPullRequest,
  DetachedHeadError,
  HeadNotPushedError,
  HeadOutOfDateError,
  resolveHeadBranch,
} from './pr-create.mts'

const execFileAsync = promisify(execFile)

function fakeRunGit(responses: Record<string, string>): RunTextCommand {
  return async (args) => {
    const key = args.join(' ')
    const response = responses[key]
    if (response === undefined) throw new Error(`unexpected git invocation: ${key}`)
    return response
  }
}

describe('resolveHeadBranch', () => {
  it('returns the trimmed current branch name', async () => {
    const runGit = fakeRunGit({ 'branch --show-current': 'feature/x\n' })
    await expect(resolveHeadBranch(runGit)).resolves.toBe('feature/x')
  })

  it('throws DetachedHeadError when there is no current branch', async () => {
    const runGit = fakeRunGit({ 'branch --show-current': '\n' })
    await expect(resolveHeadBranch(runGit)).rejects.toBeInstanceOf(DetachedHeadError)
  })
})

describe('assertHeadPushed', () => {
  it('resolves when the branch exists on the remote and matches the local branch', async () => {
    const runGit = fakeRunGit({
      'ls-remote --heads origin refs/heads/feature/x':
        '1111111111111111111111111111111111111111\trefs/heads/feature/x\n',
      'rev-parse refs/heads/feature/x': '1111111111111111111111111111111111111111\n',
    })
    await expect(assertHeadPushed(runGit, { branch: 'feature/x' })).resolves.toBeUndefined()
  })

  it('throws HeadNotPushedError when the remote lookup is empty', async () => {
    const runGit = fakeRunGit({ 'ls-remote --heads origin refs/heads/feature/x': '' })
    await expect(assertHeadPushed(runGit, { branch: 'feature/x' })).rejects.toBeInstanceOf(
      HeadNotPushedError,
    )
  })

  it('throws HeadOutOfDateError when the remote ref does not match the local branch', async () => {
    const runGit = fakeRunGit({
      'ls-remote --heads origin refs/heads/feature/x':
        '1111111111111111111111111111111111111111\trefs/heads/feature/x\n',
      'rev-parse refs/heads/feature/x': '2222222222222222222222222222222222222222\n',
    })
    await expect(assertHeadPushed(runGit, { branch: 'feature/x' })).rejects.toBeInstanceOf(
      HeadOutOfDateError,
    )
  })

  it('honors a supplied remote instead of the origin default', async () => {
    const runGit = fakeRunGit({
      'ls-remote --heads upstream refs/heads/feature/x':
        '2222222222222222222222222222222222222222\trefs/heads/feature/x\n',
      'rev-parse refs/heads/feature/x': '2222222222222222222222222222222222222222\n',
    })
    await expect(
      assertHeadPushed(runGit, { branch: 'feature/x', remote: 'upstream' }),
    ).resolves.toBeUndefined()
  })
})

describe('buildGhPrCreateArgs', () => {
  it('builds the minimal argv, always including --head', () => {
    expect(buildGhPrCreateArgs({ title: 't', bodyFile: 'body.md', head: 'feature/x' })).toEqual([
      'pr',
      'create',
      '--title',
      't',
      '--body-file',
      'body.md',
      '--head',
      'feature/x',
    ])
  })

  it('adds base, draft, labels, and reviewers when supplied', () => {
    expect(
      buildGhPrCreateArgs({
        base: 'main',
        bodyFile: 'body.md',
        draft: true,
        head: 'feature/x',
        labels: ['a', 'b'],
        reviewers: ['alice'],
        title: 't',
      }),
    ).toEqual([
      'pr',
      'create',
      '--title',
      't',
      '--body-file',
      'body.md',
      '--head',
      'feature/x',
      '--base',
      'main',
      '--draft',
      '--label',
      'a',
      '--label',
      'b',
      '--reviewer',
      'alice',
    ])
  })
})

describe('createPullRequest', () => {
  it('resolves the head branch, verifies it is pushed, then creates the pull request', async () => {
    const ghCalls: string[][] = []
    const runGh: RunTextCommand = async (args) => {
      ghCalls.push(args)
      return 'https://github.com/o/r/pull/1\n'
    }
    const runGit = fakeRunGit({
      'branch --show-current': 'feature/x\n',
      'ls-remote --heads origin refs/heads/feature/x':
        '1111111111111111111111111111111111111111\trefs/heads/feature/x\n',
      'rev-parse refs/heads/feature/x': '1111111111111111111111111111111111111111\n',
    })
    await expect(
      createPullRequest({ runGh, runGit }, { bodyFile: 'body.md', title: 't' }),
    ).resolves.toBe('https://github.com/o/r/pull/1')
    expect(ghCalls).toEqual([
      ['pr', 'create', '--title', 't', '--body-file', 'body.md', '--head', 'feature/x'],
    ])
  })

  it('uses a supplied head branch without resolving one via git', async () => {
    const runGh: RunTextCommand = async () => 'https://github.com/o/r/pull/2\n'
    const runGit = fakeRunGit({
      'ls-remote --heads origin refs/heads/feature/y':
        '3333333333333333333333333333333333333333\trefs/heads/feature/y\n',
      'rev-parse refs/heads/feature/y': '3333333333333333333333333333333333333333\n',
    })
    await expect(
      createPullRequest({ runGh, runGit }, { bodyFile: 'body.md', head: 'feature/y', title: 't' }),
    ).resolves.toBe('https://github.com/o/r/pull/2')
  })

  it('honors a supplied remote when verifying the head is pushed', async () => {
    const runGh: RunTextCommand = async () => 'https://github.com/o/r/pull/3\n'
    const runGit = fakeRunGit({
      'ls-remote --heads upstream refs/heads/feature/y':
        '4444444444444444444444444444444444444444\trefs/heads/feature/y\n',
      'rev-parse refs/heads/feature/y': '4444444444444444444444444444444444444444\n',
    })
    await expect(
      createPullRequest(
        { runGh, runGit },
        { bodyFile: 'body.md', head: 'feature/y', remote: 'upstream', title: 't' },
      ),
    ).resolves.toBe('https://github.com/o/r/pull/3')
  })

  it('rejects before calling gh when the head is not pushed', async () => {
    const runGh: RunTextCommand = async () => {
      throw new Error('gh should not be called')
    }
    const runGit = fakeRunGit({ 'ls-remote --heads origin refs/heads/feature/y': '' })
    await expect(
      createPullRequest({ runGh, runGit }, { bodyFile: 'body.md', head: 'feature/y', title: 't' }),
    ).rejects.toBeInstanceOf(HeadNotPushedError)
  })

  it('rejects before calling gh when the local branch is ahead of the pushed remote branch', async () => {
    const runGh: RunTextCommand = async () => {
      throw new Error('gh should not be called')
    }
    const runGit = fakeRunGit({
      'ls-remote --heads origin refs/heads/feature/y':
        '3333333333333333333333333333333333333333\trefs/heads/feature/y\n',
      'rev-parse refs/heads/feature/y': '5555555555555555555555555555555555555555\n',
    })
    await expect(
      createPullRequest({ runGh, runGit }, { bodyFile: 'body.md', head: 'feature/y', title: 't' }),
    ).rejects.toBeInstanceOf(HeadOutOfDateError)
  })
})

// Mirrors the require-up-to-date module's own pattern: fakes cover every branch above, and this
// suite proves the real `git branch --show-current` / `git ls-remote --heads` subcommand syntax
// is correct against an actual repository and a local bare "remote" — not just that a fake echoes
// back canned output.
//
// Every git call names its repository through `cwd` instead of `process.chdir`. A test that times
// out keeps running after `afterEach`, and with a restored process cwd its remaining git commands
// (`checkout -b`, `push`, `commit`) would land in the checkout running the suite.
describe('createPullRequest — real git integration', () => {
  const timeout = 30_000
  const testDirs: string[] = []

  afterEach(async () => {
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  function gitIn(cwd: string): RunTextCommand {
    return async (args) => (await execFileAsync('git', args, { cwd })).stdout
  }

  async function createRepoWithRemote(): Promise<RunTextCommand> {
    const repoDir = await mkdtemp(join(tmpdir(), 'gh-cli-pr-create-repo-'))
    const remoteDir = await mkdtemp(join(tmpdir(), 'gh-cli-pr-create-remote-'))
    testDirs.push(repoDir, remoteDir)

    await gitIn(remoteDir)(['init', '--bare'])
    const git = gitIn(repoDir)
    await git(['init', '-b', 'main'])
    await git(['config', 'user.email', 'gh-cli-test@example.com'])
    await git(['config', 'user.name', 'gh-cli test'])
    await git(['commit', '--allow-empty', '-m', 'initial commit'])
    await git(['remote', 'add', 'origin', remoteDir])
    return git
  }

  it(
    'resolves and confirms a pushed branch against a real remote',
    async () => {
      const git = await createRepoWithRemote()
      await git(['checkout', '-b', 'feature/real'])
      await git(['push', '-u', 'origin', 'feature/real'])

      const branch = await resolveHeadBranch(git)
      expect(branch).toBe('feature/real')
      await expect(assertHeadPushed(git, { branch })).resolves.toBeUndefined()
    },
    timeout,
  )

  it(
    'fails assertHeadPushed against a real remote when the branch was never pushed',
    async () => {
      const git = await createRepoWithRemote()
      await git(['checkout', '-b', 'feature/unpushed'])

      const branch = await resolveHeadBranch(git)
      expect(branch).toBe('feature/unpushed')
      await expect(assertHeadPushed(git, { branch })).rejects.toBeInstanceOf(HeadNotPushedError)
    },
    timeout,
  )

  it(
    'fails assertHeadPushed against a real remote when the local branch has an unpushed commit',
    async () => {
      const git = await createRepoWithRemote()
      await git(['checkout', '-b', 'feature/stale'])
      await git(['push', '-u', 'origin', 'feature/stale'])
      await git(['commit', '--allow-empty', '-m', 'a newer local commit'])

      const branch = await resolveHeadBranch(git)
      expect(branch).toBe('feature/stale')
      await expect(assertHeadPushed(git, { branch })).rejects.toBeInstanceOf(HeadOutOfDateError)
    },
    timeout,
  )
})
