import { execFile, spawn } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const script = resolve('packages/vouchington-tooling/scripts/worktree/operation-lock.sh')
const testDirs: string[] = []
let root: string

function run(command: string, env: Record<string, string> = {}) {
  return execFileAsync('bash', ['-c', `source "${script}"; ${command}`], {
    env: { ...process.env, ...env },
  })
}

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  )
}

/** A short-lived process whose PID is guaranteed dead once this resolves. */
async function deadPid() {
  const child = spawn('true')
  await new Promise((done) => child.on('close', done))
  return child.pid as number
}

describe('operation-lock.sh', () => {
  beforeEach(async () => {
    const parent = await mkdtemp(join(tmpdir(), 'operation-lock-'))
    testDirs.push(parent)
    root = join(parent, 'locks')
  })

  afterEach(async () => {
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('acquires, records the owner PID, and releases', async () => {
    const { stdout } = await run(
      `worktree_operation_lock_acquire "${root}" || exit 1
       echo "$WORKTREE_OPERATION_LOCK_TOKEN"
       cat "${root}/$WORKTREE_OPERATION_LOCK_TOKEN"
       [ -L "${root}/lock" ] && echo held
       worktree_operation_lock_release
       [ -L "${root}/lock" ] || echo released
       echo "token=\${WORKTREE_OPERATION_LOCK_TOKEN:-unset}"`,
    )
    const lines = stdout.trim().split('\n')
    expect(lines[0]).toMatch(/^owner\.\d+\.\d+$/)
    expect(Number(lines[1])).toBeGreaterThan(0)
    expect(lines.slice(2)).toEqual(['held', 'released', 'token=unset'])
    expect(await readdir(root)).toEqual([])
  })

  it('reads the root from WORKTREE_OPERATION_LOCK_ROOT', async () => {
    await run('worktree_operation_lock_acquire', { WORKTREE_OPERATION_LOCK_ROOT: root })
    expect(await exists(join(root, 'lock'))).toBe(true)
  })

  it('rejects a missing or relative root', async () => {
    await expect(
      run('worktree_operation_lock_acquire', { WORKTREE_OPERATION_LOCK_ROOT: '' }),
    ).rejects.toMatchObject({ stderr: expect.stringMatching(/root is not set/) })
    await expect(run('worktree_operation_lock_acquire relative/dir')).rejects.toMatchObject({
      stderr: expect.stringMatching(/must be an absolute path/),
    })
    await expect(run('worktree_operation_lock_clear_stale relative')).rejects.toMatchObject({
      code: 2,
    })
  })

  it('fails while a live process holds the lock', async () => {
    const holder = spawn('bash', [
      '-c',
      `source "${script}"; worktree_operation_lock_acquire "${root}" && echo ready && sleep 30`,
    ])
    try {
      await new Promise<void>((ready) => holder.stdout.once('data', () => ready()))
      await expect(run(`worktree_operation_lock_acquire "${root}"`)).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          `another worktree operation is running (PID ${holder.pid})`,
        ),
      })
      const status = await run(
        `worktree_operation_lock_clear_stale "${root}"; echo "$WORKTREE_OPERATION_LOCK_CLEANUP_STATUS"`,
      ).catch((error: { stdout: string }) => error)
      expect(status.stdout.trim()).toBe('active')
      expect(await exists(join(root, 'lock'))).toBe(true)
    } finally {
      holder.kill()
    }
  })

  async function plantLock(content: string, token = 'owner.1.2') {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, token), content)
    await symlink(token, join(root, 'lock'))
  }

  it('reports a stale holder without taking the lock, then clears it', async () => {
    await plantLock(`${await deadPid()}\n`)

    await expect(run(`worktree_operation_lock_acquire "${root}"`)).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /lock is stale; clear it with worktree_operation_lock_clear_stale/,
      ),
    })
    // The failed attempt removes its own owner file and leaves the holder's.
    expect((await readdir(root)).sort()).toEqual(['lock', 'owner.1.2'])

    const { stdout } = await run(
      `worktree_operation_lock_clear_stale "${root}"; echo "$WORKTREE_OPERATION_LOCK_CLEANUP_STATUS"
       worktree_operation_lock_acquire "${root}" && echo acquired`,
    )
    expect(stdout.trim().split('\n')).toEqual(['removed', 'acquired'])
  })

  it('treats a holder with an unreadable PID file as stale', async () => {
    await mkdir(root, { recursive: true })
    await symlink('owner.1.2', join(root, 'lock'))
    const { stdout } = await run(
      `worktree_operation_lock_clear_stale "${root}"; echo "$WORKTREE_OPERATION_LOCK_CLEANUP_STATUS"`,
    )
    expect(stdout.trim()).toBe('removed')
  })

  it('reports a missing lock as missing and succeeds', async () => {
    const { stdout } = await run(
      `worktree_operation_lock_clear_stale "${root}"; echo "$? $WORKTREE_OPERATION_LOCK_CLEANUP_STATUS"`,
    )
    expect(stdout.trim()).toBe('0 missing')
  })

  it('refuses a lock with an invalid owner token', async () => {
    await mkdir(root, { recursive: true })
    await symlink('somewhere-else', join(root, 'lock'))

    await expect(run(`worktree_operation_lock_acquire "${root}"`)).rejects.toMatchObject({
      stderr: expect.stringMatching(/invalid owner/),
    })
    const { stdout } = await run(
      `worktree_operation_lock_clear_stale "${root}"; echo "$?" "$WORKTREE_OPERATION_LOCK_CLEANUP_STATUS"`,
    )
    expect(stdout.trim()).toBe('1 invalid')
    expect(await readdir(root)).toEqual(['lock'])
  })

  it('refuses a lock path that is not a symbolic link', async () => {
    await mkdir(join(root, 'lock'), { recursive: true })

    await expect(run(`worktree_operation_lock_acquire "${root}"`)).rejects.toMatchObject({
      stderr: expect.stringMatching(/not a symbolic link/),
    })
    expect(await readdir(root)).toEqual(['lock'])
  })

  it('does not leave a link inside a directory the lock points to', async () => {
    await mkdir(join(root, 'owner.1.2'), { recursive: true })
    await symlink('owner.1.2', join(root, 'lock'))

    await expect(run(`worktree_operation_lock_acquire "${root}"`)).rejects.toMatchObject({
      code: 1,
    })
    expect(await readdir(join(root, 'owner.1.2'))).toEqual([])
  })

  it('release leaves a lock another process now holds', async () => {
    const { stdout } = await run(
      `worktree_operation_lock_acquire "${root}" || exit 1
       rm "${root}/lock"; ln -s owner.9.9 "${root}/lock"
       worktree_operation_lock_release
       readlink "${root}/lock"`,
    )
    expect(stdout.trim()).toBe('owner.9.9')
  })

  it('release is a no-op without a held lock', async () => {
    await run('worktree_operation_lock_release')
    expect(await exists(root)).toBe(false)
  })

  it('rejects a second acquisition by a shell that already holds a lock', async () => {
    const other = `${root}-other`
    testDirs.push(other)
    const { stdout, stderr } = await run(
      `worktree_operation_lock_acquire "${root}" || exit 1
       worktree_operation_lock_acquire "${other}" || echo rejected
       worktree_operation_lock_release
       [ -L "${root}/lock" ] || echo released`,
    )
    expect(stdout.trim().split('\n')).toEqual(['rejected', 'released'])
    expect(stderr).toMatch(/already holds/)
    expect(await exists(other)).toBe(false)
  })

  it('records the subshell PID so a dead subshell leaves a stale lock', async () => {
    const { stdout } = await run(
      `( worktree_operation_lock_acquire "${root}" )
       worktree_operation_lock_clear_stale "${root}"; echo "$WORKTREE_OPERATION_LOCK_CLEANUP_STATUS"`,
    )
    expect(stdout.trim()).toBe('removed')
  })

  it('reports busy while another clearer holds the clearing mutex', async () => {
    await plantLock(`${await deadPid()}\n`)
    await symlink(String(process.pid), join(root, 'clearing'))
    const { stdout } = await run(
      `worktree_operation_lock_clear_stale "${root}"; echo "$? $WORKTREE_OPERATION_LOCK_CLEANUP_STATUS"`,
    )
    expect(stdout.trim()).toBe('1 busy')
    expect(await exists(join(root, 'lock'))).toBe(true)
  })

  it('recovers a clearing mutex whose owner died', async () => {
    await plantLock(`${await deadPid()}\n`)
    await symlink(String(await deadPid()), join(root, 'clearing'))
    const { stdout } = await run(
      `worktree_operation_lock_clear_stale "${root}"; echo "$? $WORKTREE_OPERATION_LOCK_CLEANUP_STATUS"`,
    )
    expect(stdout.trim()).toBe('0 removed')
    expect(await readdir(root)).toEqual([])
  })

  it('keeps the caller status variable intact', async () => {
    await plantLock(`${await deadPid()}\n`)
    const { stdout } = await run(
      `status=42; worktree_operation_lock_clear_stale "${root}"; echo "$status"`,
    )
    expect(stdout.trim()).toBe('42')
  })

  it.skipIf(process.getuid?.() === 0)('fails when the owner PID cannot be recorded', async () => {
    await mkdir(root, { recursive: true })
    await chmod(root, 0o500)
    try {
      await expect(run(`worktree_operation_lock_acquire "${root}"`)).rejects.toMatchObject({
        code: 1,
      })
    } finally {
      await chmod(root, 0o700)
    }
    expect(await readdir(root)).toEqual([])
  })

  it('does not let a subshell release its parent lock', async () => {
    const { stdout } = await run(
      `worktree_operation_lock_acquire "${root}" || exit 1
       ( worktree_operation_lock_release )
       [ -L "${root}/lock" ] && echo held
       worktree_operation_lock_release
       [ -L "${root}/lock" ] || echo released`,
    )
    expect(stdout.trim().split('\n')).toEqual(['held', 'released'])
  })

  it('removes the clearing mutex when errexit aborts on a live holder', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'owner.1.2'), `${process.pid}\n`)
    await symlink('owner.1.2', join(root, 'lock'))
    await expect(
      run(`set -e; worktree_operation_lock_clear_stale "${root}"; echo unreachable`),
    ).rejects.toMatchObject({ code: 1 })
    expect(await exists(join(root, 'clearing'))).toBe(false)
  })

  it('treats a permission-denied probe as a live owner', async () => {
    await plantLock('12345\n')
    const { stdout } = await run(
      `kill() { echo 'kill: (12345) - Operation not permitted' >&2; return 1; }
       worktree_operation_lock_clear_stale "${root}"; echo "$WORKTREE_OPERATION_LOCK_CLEANUP_STATUS"`,
    )
    expect(stdout.trim()).toBe('active')
  })

  it('refuses a lock root the user does not own', async () => {
    await expect(run('worktree_operation_lock_acquire /')).rejects.toMatchObject({
      stderr: expect.stringMatching(/not owned by this user/),
    })
  })

  it('releases on EXIT when installed as a trap', async () => {
    await run(
      `trap worktree_operation_lock_release EXIT; worktree_operation_lock_acquire "${root}"`,
    )
    expect(await readdir(root)).toEqual([])
  })
})
