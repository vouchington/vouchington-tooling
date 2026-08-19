import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanupTestHomes,
  completion,
  execFileAsync,
  hostLockArgs,
  hostLockEnv,
  hostLockScript,
  makeHome,
  spawnHostLock,
  waitForPath,
} from './with-host-lock.test-helpers.mts'

async function readLockOwner(lock: string): Promise<{ pid: string; pgid: string; token: string }> {
  await waitForPath(join(lock, 'owner.pgid'))
  const [pid, pgid, token] = await Promise.all([
    readFile(join(lock, 'owner.pid'), 'utf8'),
    readFile(join(lock, 'owner.pgid'), 'utf8'),
    readFile(join(lock, 'owner.token'), 'utf8'),
  ])
  return { pid: pid.trim(), pgid: pgid.trim(), token: token.trim() }
}

describe('with-host-lock.sh --command-timeout-seconds / --on-acquire-timeout', () => {
  afterEach(async () => {
    await cleanupTestHomes()
  })

  it.each([
    {
      args: [
        '--name',
        'build',
        '--timeout-seconds',
        '1',
        '--command-timeout-seconds',
        'nope',
        '--',
        'true',
      ],
      message: 'command-timeout-seconds',
    },
    {
      args: [
        '--name',
        'build',
        '--timeout-seconds',
        '1',
        '--on-acquire-timeout',
        'bogus',
        '--',
        'true',
      ],
      message: 'on-acquire-timeout',
    },
  ])('rejects invalid invocation: $message', async ({ args, message }) => {
    const home = await makeHome()

    await expect(
      execFileAsync('bash', [hostLockScript, ...args], { env: hostLockEnv(home) }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining(message) })
  })

  it('kills a command that exceeds --command-timeout-seconds and exits 124', async () => {
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')

    const result = await completion(
      spawnHostLock(home, 'expensive-build', 5, ['sleep', '30'], {}, [
        '--command-timeout-seconds',
        '1',
      ]),
    )

    expect(result.code).toBe(124)
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not override the exit code when the command finishes within --command-timeout-seconds', async () => {
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')

    await expect(
      execFileAsync(
        'bash',
        hostLockArgs(
          'expensive-build',
          5,
          ['bash', '-c', 'exit 37'],
          ['--command-timeout-seconds', '10'],
        ),
        { env: hostLockEnv(home) },
      ),
    ).rejects.toMatchObject({ code: 37 })
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('prints the holder pid and pgid on fail-closed acquire timeout', async () => {
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const marker = join(home, 'must-not-run')
    const holder = spawnHostLock(home, 'expensive-build', 5, ['sleep', '10'])
    const held = completion(holder)
    const owner = await readLockOwner(lock)

    const rejection = await execFileAsync(
      'bash',
      hostLockArgs('expensive-build', 1, ['touch', marker]),
      { env: hostLockEnv(home) },
    ).then(
      () => {
        throw new Error('expected acquire timeout')
      },
      (error: unknown) => error as { code?: number; stderr: string },
    )
    expect(rejection.code).toBe(1)
    expect(rejection.stderr).toMatch(
      new RegExp(
        String.raw`^with-host-lock: expensive-build lock not acquired within 1s\n` +
          String.raw`with-host-lock: expensive-build waited \d+s; expensive-build owner pid=${owner.pid} pgid=${owner.pgid}\n$`,
      ),
    )
    expect(rejection.stderr).not.toContain(owner.token)
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })

    holder.kill('SIGTERM')
    await held
  })

  it('prints the holder pid and pgid when acquire timeout runs unlocked', async () => {
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const marker = join(home, 'ran-unlocked')
    const holder = spawnHostLock(home, 'expensive-build', 5, ['sleep', '10'])
    const held = completion(holder)
    const owner = await readLockOwner(lock)

    await expect(
      execFileAsync(
        'bash',
        hostLockArgs(
          'expensive-build',
          1,
          ['touch', marker],
          ['--on-acquire-timeout', 'run-unlocked'],
        ),
        { env: hostLockEnv(home) },
      ),
    ).resolves.toMatchObject({
      stderr: expect.stringMatching(
        new RegExp(
          String.raw`^with-host-lock: expensive-build lock not acquired within 1s; running unlocked\n` +
            String.raw`with-host-lock: expensive-build waited \d+s; expensive-build owner pid=${owner.pid} pgid=${owner.pgid}\n$`,
        ),
      ),
    })
    await expect(readFile(marker, 'utf8')).resolves.toBe('')

    holder.kill('SIGTERM')
    await held
  })

  it('prints missing owner fields when the lock directory has no valid pid or pgid', async () => {
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const marker = join(home, 'must-not-run')
    await mkdir(lock, { recursive: true })

    await expect(
      execFileAsync('bash', hostLockArgs('expensive-build', 1, ['touch', marker]), {
        env: hostLockEnv(home),
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(
        /^with-host-lock: expensive-build lock not acquired within 1s\nwith-host-lock: expensive-build waited \d+s; expensive-build owner pid=missing pgid=missing\n$/,
      ),
    })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('exits 1 without running the command when --on-acquire-timeout fail is passed explicitly', async () => {
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const marker = join(home, 'must-not-run')
    const holder = spawnHostLock(home, 'expensive-build', 5, ['sleep', '10'])
    const held = completion(holder)
    await waitForPath(join(lock, 'owner.token'))

    await expect(
      execFileAsync(
        'bash',
        hostLockArgs('expensive-build', 1, ['touch', marker], ['--on-acquire-timeout', 'fail']),
        { env: hostLockEnv(home) },
      ),
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('not acquired') })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })

    holder.kill('SIGTERM')
    await held
  })

  it('runs the command unlocked after the acquire deadline when --on-acquire-timeout run-unlocked is set', async () => {
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const marker = join(home, 'ran-unlocked')
    const holder = spawnHostLock(home, 'expensive-build', 5, ['sleep', '10'])
    const held = completion(holder)
    await waitForPath(join(lock, 'owner.token'))

    const start = Date.now()
    const result = await completion(
      spawnHostLock(
        home,
        'expensive-build',
        2,
        ['bash', '-c', 'touch "$1"; sleep 30', 'host-lock-test', marker],
        {},
        ['--on-acquire-timeout', 'run-unlocked', '--command-timeout-seconds', '1'],
      ),
    )
    const elapsed = Date.now() - start

    expect(result.code).toBe(124)
    expect(result.stderr).toContain('running unlocked')
    expect(elapsed).toBeGreaterThanOrEqual(2000)
    await expect(readFile(marker, 'utf8')).resolves.toBe('')
    // The original holder's lock was never touched by the unlocked contender.
    await expect(stat(lock)).resolves.toBeDefined()

    holder.kill('SIGTERM')
    await held
  })

  it('registers unlocked release markers with the EXIT cleanup path', async () => {
    const source = await readFile(hostLockScript, 'utf8')
    const cleanupStart = source.indexOf('cleanup_lock() {')
    const exitTrap = source.indexOf('trap cleanup_lock EXIT')
    const temporaryReleaseRegistration = source.indexOf('temporary_start_release=$start_release')

    expect(cleanupStart).toBeGreaterThan(-1)
    expect(source.slice(cleanupStart, exitTrap)).toContain('rm -f "$temporary_start_release"')
    expect(temporaryReleaseRegistration).toBeGreaterThan(exitTrap)
  })
})
