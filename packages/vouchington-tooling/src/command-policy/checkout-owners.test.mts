import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  checkoutOwner,
  checkoutOwners,
  defaultGitProbe,
  githubOwner,
  ownerOfRepoSelector,
  sessionHomeOwners,
} from './index.mts'

const dirs: string[] = []

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function repo(remotes: Record<string, string> = {}, config: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'command-policy-'))
  dirs.push(dir)
  git(dir, 'init', '-q', '-b', 'trunk')
  for (const [name, url] of Object.entries(remotes)) git(dir, 'remote', 'add', name, url)
  for (const [key, value] of Object.entries(config)) git(dir, 'config', key, value)
  return dir
}

beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null')
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  // Inside a git hook these point at the outer repository, which the helpers must not touch.
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) {
    vi.stubEnv(name, undefined)
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('checkoutOwner', () => {
  it.each([
    ['scp-like in another case', 'git@github.com:Widgets-Inc/tool.git'],
    ['https', 'https://github.com/widgets-inc/tool.git'],
    ['ssh with a port', 'ssh://git@github.com:22/widgets-inc/tool.git'],
    ['trailing slash', 'https://github.com/widgets-inc/tool/'],
  ])('reads a %s URL', (_name, url) => {
    expect(checkoutOwner(repo({ origin: url }))).toBe('widgets-inc')
  })

  it('reads the fetch URL, not the push URL', () => {
    const dir = repo({ origin: 'git@github.com:widgets-inc/tool.git' })
    git(dir, 'remote', 'set-url', '--push', 'origin', 'git@github.com:acme/tool.git')
    expect(checkoutOwner(dir)).toBe('widgets-inc')
  })

  it.each([
    ['only hostless remotes', { origin: '/srv/git/tool.git', mirror: 'file:///srv/git/tool.git' }],
    ['an owner-less hosted URL', { origin: 'https://github.com/tool.git' }],
    ['an owner with bad characters', { origin: 'https://github.com/we!rd/tool.git' }],
    ['two owners', { origin: 'git@github.com:forker/t.git', up: 'https://github.com/acme/t.git' }],
    ['no remotes', {}],
  ])('is undefined for %s', (_name, remotes) => {
    expect(checkoutOwner(repo(remotes))).toBeUndefined()
  })

  it('is undefined outside a repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'command-policy-bare-'))
    dirs.push(dir)
    vi.stubEnv('GIT_CEILING_DIRECTORIES', dir)
    expect(checkoutOwners(dir)).toBeUndefined()
  })
})

describe('checkoutOwners', () => {
  it('collects remote and set-default owners, skipping hostless remotes and `base`', () => {
    const remotes = {
      origin: 'git@github.com:forker/tool.git',
      upstream: 'https://github.com/acme/tool.git',
      mirror: '/srv/git/tool.git',
    }
    expect(checkoutOwners(repo(remotes))).toEqual(new Set(['forker', 'acme']))
    const config = { 'remote.origin.gh-resolved': 'Widgets-Inc/tool' }
    expect(checkoutOwners(repo(remotes, config))).toEqual(
      new Set(['forker', 'acme', 'widgets-inc']),
    )
    expect(checkoutOwners(repo(remotes, { 'remote.origin.gh-resolved': 'base' }))).toEqual(
      new Set(['forker', 'acme']),
    )
  })

  it('is undefined when a set-default is not an owner/repo selector', () => {
    expect(
      checkoutOwners(
        repo(
          { origin: 'https://github.com/acme/t.git' },
          { 'remote.origin.gh-resolved': 'not-a-selector' },
        ),
      ),
    ).toBeUndefined()
  })

  it('is undefined when a remote line is not recognized', () => {
    const dir = repo({ origin: 'https://github.com/acme/tool.git' })
    git(dir, 'config', 'remote.origin.url', 'https://github.com/acme/a/b/c.git')
    expect(checkoutOwners(dir)).toBeUndefined()
  })
})

describe('ownerOfRepoSelector and githubOwner', () => {
  it.each([
    ['Acme/tool', 'acme'],
    ['github.com/Acme/tool', 'acme'],
    ['https://github.com/acme/tool/', 'acme'],
  ])('reads %s', (value, owner) => {
    expect(ownerOfRepoSelector(value)).toBe(owner)
  })

  it.each(['tool', 'a/b/c/d', '$OWNER/tool', 'acme//tool', 'a b/c', '*/tool'])(
    'rejects %j',
    (value) => {
      expect(ownerOfRepoSelector(value)).toBeUndefined()
    },
  )

  it('rejects owners that shell expansion could produce', () => {
    expect(githubOwner('$X')).toBeUndefined()
    expect(githubOwner('')).toBeUndefined()
    expect(githubOwner('Acme_1')).toBe('acme_1')
  })
})

describe('sessionHomeOwners', () => {
  function manifest(dir: string, value: unknown): void {
    writeFileSync(
      join(dir, 'package.json'),
      typeof value === 'string' ? value : JSON.stringify(value),
    )
  }
  const fork = { origin: 'git@github.com:forker/tool.git' }

  it('adds the declared repository owner to the checkout owners', () => {
    const dir = repo(fork)
    manifest(dir, { repository: 'git+https://github.com/acme/tool.git' })
    expect(sessionHomeOwners(dir)).toEqual(new Set(['forker', 'acme']))
    manifest(dir, { repository: { url: 'git@github.com:acme/tool.git' } })
    expect(sessionHomeOwners(dir)).toEqual(new Set(['forker', 'acme']))
  })

  it('uses the checkout owners alone when no repository is declared or no manifest exists', () => {
    const dir = repo(fork)
    expect(sessionHomeOwners(dir)).toEqual(new Set(['forker']))
    manifest(dir, { name: 'x' })
    expect(sessionHomeOwners(dir)).toEqual(new Set(['forker']))
  })

  it('is undefined when nothing is known or a declaration is unreadable', () => {
    expect(sessionHomeOwners(repo())).toBeUndefined()
    const dir = repo(fork)
    manifest(dir, '{ not json')
    expect(sessionHomeOwners(dir)).toBeUndefined()
    manifest(dir, { repository: 'acme/tool' })
    expect(sessionHomeOwners(dir)).toBeUndefined()
    manifest(dir, { repository: { directory: 'x' } })
    expect(sessionHomeOwners(dir)).toBeUndefined()
    manifest(dir, { repository: 'https://github.com/only-one-segment' })
    expect(sessionHomeOwners(dir)).toBeUndefined()
    const unreadable = repo(fork)
    mkdirSync(join(unreadable, 'package.json'))
    expect(sessionHomeOwners(unreadable)).toBeUndefined()
    expect(sessionHomeOwners(join(unreadable, 'missing'))).toBeUndefined()
  })

  it('treats a declared hostless repository as unreadable', () => {
    const dir = repo(fork)
    manifest(dir, { repository: 'file:///srv/tool.git' })
    expect(sessionHomeOwners(dir)).toBeUndefined()
  })
})

describe('defaultGitProbe', () => {
  function commit(dir: string, message: string): void {
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', message],
      {
        cwd: dir,
        stdio: 'ignore',
      },
    )
  }

  it('answers branch, config, ref, and ancestry questions', () => {
    const dir = repo({}, { 'branch.trunk.gh-merge-base': 'dev', 'user.empty': '' })
    commit(dir, 'one')
    git(dir, 'branch', 'first')
    commit(dir, 'two')
    expect(defaultGitProbe.currentBranch(dir)).toBe('trunk')
    expect(defaultGitProbe.configValue(dir, 'branch.trunk.gh-merge-base')).toBe('dev')
    expect(defaultGitProbe.configValue(dir, 'user.empty')).toBeUndefined()
    expect(defaultGitProbe.configValue(dir, 'user.missing')).toBeUndefined()
    expect(defaultGitProbe.resolveRef(dir, 'refs/heads/first')).toMatch(/^[0-9a-f]{40}$/)
    expect(defaultGitProbe.resolveRef(dir, 'refs/heads/nope')).toBeUndefined()
    expect(defaultGitProbe.isAncestor(dir, 'first', 'HEAD')).toBe(true)
    expect(defaultGitProbe.isAncestor(dir, 'HEAD', 'first')).toBe(false)
    expect(defaultGitProbe.isAncestor(dir, 'nope', 'HEAD')).toBeUndefined()
  })

  it('has no branch on a detached HEAD and no answers outside a repository', () => {
    const dir = repo()
    commit(dir, 'one')
    git(dir, 'checkout', '-q', '--detach')
    expect(defaultGitProbe.currentBranch(dir)).toBeUndefined()
    expect(defaultGitProbe.currentBranch(join(dir, 'missing'))).toBeUndefined()
  })

  it('ignores inherited GIT_DIR overrides', () => {
    const dir = repo({ origin: 'https://github.com/acme/t.git' })
    vi.stubEnv('GIT_DIR', '/nonexistent')
    expect(checkoutOwner(dir)).toBe('acme')
  })
})
