import { readFile, stat } from 'node:fs/promises'
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
  withFinalTimeoutProbe,
} from './with-host-lock.test-helpers.mts'

describe('with-host-lock.sh timeout behavior', () => {
  afterEach(async () => {
    await cleanupTestHomes()
  })

  it('fails closed on timeout without starting the waiting command', async () => {
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const marker = join(home, 'must-not-run')
    const holder = spawnHostLock(home, 'expensive-build', 5, ['sleep', '10'])
    const held = completion(holder)
    await waitForPath(join(lock, 'owner.token'))

    await expect(
      execFileAsync('bash', hostLockArgs('expensive-build', 1, ['touch', marker]), {
        env: hostLockEnv(home),
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('not acquired'),
    })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })

    holder.kill('SIGTERM')
    await held
  })

  it('starts an unlocked fallback by its configured deadline and marks its child active', async () => {
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const holder = spawnHostLock(home, 'expensive-build', 5, ['sleep', '10'])
    const held = completion(holder)
    await waitForPath(join(lock, 'owner.token'))

    try {
      const start = Date.now()
      await expect(
        execFileAsync(
          'bash',
          [
            hostLockScript,
            '--name',
            'expensive-build',
            '--timeout-seconds',
            '1',
            '--on-acquire-timeout',
            'run-unlocked',
            '--',
            'bash',
            '-c',
            '[ "$HOST_LOCK_ACTIVE" = 1 ]',
          ],
          { env: hostLockEnv(home) },
        ),
      ).resolves.toMatchObject({
        stderr: expect.stringContaining('running unlocked'),
      })
      expect(Date.now() - start).toBeLessThan(1800)
    } finally {
      holder.kill('SIGTERM')
      await held
    }
  })

  it('reclaims and acquires the selected slot on the final timeout probe', async () => {
    const home = await makeHome()
    await withFinalTimeoutProbe(home, async ({ lock, marker, contenderDone }) => {
      await expect(contenderDone).resolves.toEqual({
        code: 0,
        stderr: expect.stringMatching(/^with-host-lock: expensive-build acquired after \d+s\n$/),
      })
      await expect(readFile(marker, 'utf8')).resolves.toBe('')
      await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  }, 10_000)
})
