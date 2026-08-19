import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanupTestHomes,
  completion,
  execFileAsync,
  hostLockArgs,
  hostLockEnv,
  makeHome,
  spawnHostLock,
  waitForPath,
} from './with-host-lock.test-helpers.mts'

describe('with-host-lock.sh slot pools', () => {
  afterEach(cleanupTestHomes)

  it('allows only the configured number of callers into a slot pool', async () => {
    const home = await makeHome()
    const extraArgs = ['--slots', '2']
    const first = spawnHostLock(home, 'memory-heavy', 5, ['sleep', '10'], {}, extraArgs)
    const second = spawnHostLock(home, 'memory-heavy', 5, ['sleep', '10'], {}, extraArgs)
    const firstCompletion = completion(first)
    const secondCompletion = completion(second)
    const slot1 = join(home, '.cache/host-lock/memory-heavy-slot-1.lock.d')
    const slot2 = join(home, '.cache/host-lock/memory-heavy-slot-2.lock.d')
    await Promise.all([
      waitForPath(join(slot1, 'owner.pgid')),
      waitForPath(join(slot2, 'owner.pgid')),
    ])
    const [firstPid, secondPid] = await Promise.all([
      readFile(join(slot1, 'owner.pid'), 'utf8').then((text) => text.trim()),
      readFile(join(slot2, 'owner.pid'), 'utf8').then((text) => text.trim()),
    ])

    const marker = join(home, 'must-not-run')
    const rejection = await execFileAsync(
      'bash',
      hostLockArgs('memory-heavy', 1, ['touch', marker], extraArgs),
      { env: hostLockEnv(home) },
    ).then(
      () => {
        throw new Error('expected acquire timeout')
      },
      (error: unknown) => error as { stderr: string },
    )
    expect(rejection.stderr).toContain('not acquired')
    expect(rejection.stderr).toMatch(
      new RegExp(
        String.raw`with-host-lock: memory-heavy waited \d+s; memory-heavy-slot-1 owner pid=${firstPid} pgid=`,
      ),
    )
    expect(rejection.stderr).toMatch(
      new RegExp(
        String.raw`with-host-lock: memory-heavy waited \d+s; memory-heavy-slot-2 owner pid=${secondPid} pgid=`,
      ),
    )
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })

    first.kill('SIGTERM')
    await firstCompletion
    await expect(
      execFileAsync('bash', hostLockArgs('memory-heavy', 3, ['touch', marker], extraArgs), {
        env: hostLockEnv(home),
      }),
    ).resolves.toMatchObject({
      stderr: expect.stringMatching(/^with-host-lock: memory-heavy acquired after \d+s\n$/),
    })
    await expect(readFile(marker, 'utf8')).resolves.toBe('')

    second.kill('SIGTERM')
    await secondCompletion
  })

  it('keeps slot one stable when callers use different pool capacities', async () => {
    const home = await makeHome()
    const holder = spawnHostLock(home, 'memory-heavy', 5, ['sleep', '10'], {}, ['--slots', '2'])
    const holderCompletion = completion(holder)
    await waitForPath(join(home, '.cache/host-lock/memory-heavy-slot-1.lock.d/owner.token'))

    const marker = join(home, 'must-not-run')
    await expect(
      execFileAsync('bash', hostLockArgs('memory-heavy', 1, ['touch', marker], ['--slots', '1']), {
        env: hostLockEnv(home),
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('not acquired'),
    })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(home, '.cache/host-lock/memory-heavy.lock.d'))).rejects.toMatchObject({
      code: 'ENOENT',
    })

    holder.kill('SIGTERM')
    await holderCompletion
  })
})
