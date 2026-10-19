import { spawn, spawnSync } from 'node:child_process'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

const exec = promisify(execFile)
const script = resolve('packages/vouchington-tooling/scripts/worktree/reset-worktree.sh')
const roots: string[] = []
const children: number[] = []

async function git(repo: string, args: string[]) {
  await exec('git', ['-C', repo, ...args])
}

async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'worktree-reset-'))
  roots.push(root)
  await exec('git', ['init', '-b', 'main', root])
  await git(root, ['config', 'user.email', 'test@example.com'])
  await git(root, ['config', 'user.name', 'Test'])
  await writeFile(join(root, 'README'), 'one\n')
  await git(root, ['add', 'README'])
  await git(root, ['commit', '-m', 'init'])
  return root
}

function run(root: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(script, ['--root', root, ...args], { encoding: 'utf8', env })
}

describe('reset-worktree.sh', () => {
  afterEach(async () => {
    for (const pid of children.splice(0)) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // The child already exited.
      }
    }
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
  })

  it('prints usage for help and rejects incomplete arguments', () => {
    const help = spawnSync(script, ['--help'], { encoding: 'utf8' })
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('--base-ref')

    const missing = spawnSync(script, [], { encoding: 'utf8' })
    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain('--base-ref is required')

    const unknown = spawnSync(script, ['--base-ref', 'main', '--wat'], { encoding: 'utf8' })
    expect(unknown.status).toBe(2)
    expect(unknown.stderr).toContain('unknown option')

    const duplicate = spawnSync(script, ['--force', '-f', '--base-ref', 'main'], {
      encoding: 'utf8',
    })
    expect(duplicate.status).toBe(2)
    expect(duplicate.stderr).toContain('duplicate option')

    const combined = spawnSync(script, ['--help', '--force'], { encoding: 'utf8' })
    expect(combined.status).toBe(2)
    expect(combined.stderr).toContain('help cannot be combined')
  })

  it('hard-resets a clean tree onto a local ref without fetching', async () => {
    const root = await initRepo()
    await writeFile(join(root, 'README'), 'two\n')
    await git(root, ['add', 'README'])
    await git(root, ['commit', '-m', 'second'])
    await git(root, ['branch', 'base', 'HEAD~1'])

    const result = run(root, [
      '--base-ref',
      'base',
      '--post',
      'git branch --show-current > post-branch',
    ])

    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/^reset-branch=reset-[0-9a-f]{8}\n$/)
    expect(await readFile(join(root, 'README'), 'utf8')).toBe('one\n')
    expect(await readFile(join(root, 'post-branch'), 'utf8')).toMatch(/^reset-[0-9a-f]{8}\n$/)
  })

  it('fetches a remote branch and runs the pre hook before switching', async () => {
    const origin = await mkdtemp(join(tmpdir(), 'worktree-reset-origin-'))
    roots.push(origin)
    await exec('git', ['init', '--bare', '-b', 'main', origin])
    const root = await initRepo()
    await git(root, ['remote', 'add', 'origin', origin])
    await git(root, ['push', '-u', 'origin', 'HEAD:main'])
    const other = await mkdtemp(join(tmpdir(), 'worktree-reset-other-'))
    roots.push(other)
    await exec('git', ['clone', origin, other])
    await exec('git', ['-C', other, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', other, 'config', 'user.name', 'Test'])
    await writeFile(join(other, 'README'), 'remote\n')
    await exec('git', ['-C', other, 'add', 'README'])
    await exec('git', ['-C', other, 'commit', '-m', 'remote'])
    await exec('git', ['-C', other, 'push', 'origin', 'HEAD:main'])

    const result = run(root, [
      '--base-ref',
      'origin/main',
      '--pre',
      'git branch --show-current > pre-branch',
    ])

    expect(result.status).toBe(0)
    expect(await readFile(join(root, 'README'), 'utf8')).toBe('remote\n')
    expect(await readFile(join(root, 'pre-branch'), 'utf8')).toBe('main\n')
  })

  it('refuses a dirty or untracked tree unless --force discards it', async () => {
    const root = await initRepo()
    await writeFile(join(root, 'README'), 'dirty\n')
    const dirty = run(root, ['--base-ref', 'main'])
    expect(dirty.status).toBe(1)
    expect(dirty.stderr).toContain('uncommitted changes')
    expect(
      spawnSync('git', ['-C', root, 'branch', '--list', 'reset-*'], { encoding: 'utf8' }).stdout,
    ).toBe('')

    await git(root, ['checkout', '--', 'README'])
    await writeFile(join(root, 'extra.txt'), 'extra\n')
    const untracked = run(root, ['--base-ref', 'main'])
    expect(untracked.status).toBe(1)
    expect(untracked.stderr).toContain('untracked files')

    const forced = run(root, ['--base-ref', 'main', '--force'])
    expect(forced.status).toBe(0)
    expect(await readFile(join(root, 'README'), 'utf8')).toBe('one\n')
    await expect(readFile(join(root, 'extra.txt'), 'utf8')).rejects.toThrow()
  })

  it('removes caller cache paths and disposable cache directories', async () => {
    const root = await initRepo()
    await writeFile(join(root, '.gitignore'), 'dist/\nnode_modules/\n.cache/\n')
    await git(root, ['add', '.gitignore'])
    await git(root, ['commit', '-m', 'ignore generated output'])
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(join(root, 'dist', 'out.js'), 'built\n')
    await mkdir(join(root, 'pkg', '.cache'), { recursive: true })
    await writeFile(join(root, 'pkg', '.cache', 'x'), 'x\n')
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'keep\n')
    await mkdir(join(root, 'node_modules', '.vite'), { recursive: true })
    await writeFile(join(root, 'node_modules', '.vite', 'x'), 'x\n')
    const outside = join(root, '..', 'outside-cache')
    await writeFile(outside, 'keep\n')
    roots.push(outside)

    const escaped = run(root, ['--base-ref', 'main', '--cache', '../outside-cache'])
    expect(escaped.status).toBe(2)
    expect(await readFile(outside, 'utf8')).toBe('keep\n')

    const result = run(root, ['--base-ref', 'refs/heads/main', '--cache', 'dist'])
    expect(result.status).toBe(0)
    await expect(readFile(join(root, 'dist', 'out.js'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(root, 'pkg', '.cache', 'x'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(root, 'node_modules', 'pkg', 'index.js'), 'utf8')).toBe('keep\n')
    await expect(readFile(join(root, 'node_modules', '.vite', 'x'), 'utf8')).rejects.toThrow()
  })

  it('refuses a non-empty index lock and clears a zero-byte lock', async () => {
    const root = await initRepo()
    const linked = join(root, '..', 'linked-worktree')
    roots.push(linked)
    await exec('git', ['-C', root, 'worktree', 'add', linked, '-b', 'linked'])
    const gitdir = (await readFile(join(linked, '.git'), 'utf8')).replace(/^gitdir: */, '').trim()
    await writeFile(join(gitdir, 'index.lock'), 'busy\n')

    const busy = run(linked, ['--base-ref', 'linked', '--pre', 'touch pre-ran'])
    expect(busy.status).toBe(1)
    expect(busy.stderr).toContain('non-empty')
    await expect(readFile(join(linked, 'pre-ran'), 'utf8')).rejects.toThrow()

    await writeFile(join(gitdir, 'index.lock'), '')
    const cleared = run(linked, ['--base-ref', 'linked'])
    expect(cleared.status).toBe(0)
    await expect(readFile(join(gitdir, 'index.lock'), 'utf8')).rejects.toThrow()
  })

  it('refuses a second reset while the lock is held', async () => {
    const root = await initRepo()
    const first = spawn(
      script,
      ['--root', root, '--base-ref', 'main', '--pre', 'touch locked; sleep 30'],
      {
        detached: true,
        stdio: 'ignore',
      },
    )
    if (first.pid !== undefined) children.push(first.pid)
    const locked = join(root, 'locked')
    for (let attempt = 0; attempt < 50 && !(await readable(locked)); attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    }
    const second = run(root, ['--base-ref', 'main'])
    expect(second.status).toBe(1)
    expect(second.stderr).toContain('another worktree reset is running')
  })

  it('resets through lockf when flock is not on PATH', async () => {
    const root = await initRepo()
    const bin = await mkdtemp(join(tmpdir(), 'worktree-reset-bin-'))
    roots.push(bin)
    for (const command of ['bash', 'dirname', 'git', 'openssl', 'sed', 'find', 'rm', 'mkdir', 'env']) {
      const path = spawnSync('bash', ['-lc', `command -v ${command}`], {
        encoding: 'utf8',
      }).stdout.trim()
      if (path === '') throw new Error(`missing ${command}`)
      await symlink(path, join(bin, command))
    }
    const lockf = join(bin, 'lockf')
    await writeFile(
      lockf,
      `#!/bin/sh
while [ $# -gt 0 ]; do
  case "$1" in
    -t) shift 2 ;;
    -*) shift ;;
    *) shift; break ;;
  esac
done
exec "$@"
`,
    )
    await chmod(lockf, 0o755)
    const result = run(root, ['--base-ref', 'main'], {
      ...process.env,
      PATH: bin,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('reset-branch=reset-')
  })
})

async function readable(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}
