import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises'
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

describe('with-host-lock.sh lease and reclamation', () => {
  afterEach(async () => {
    await cleanupTestHomes()
  })

  it('reclaims a lock whose recorded owner is dead', async () => {
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const marker = join(home, 'ran')
    await mkdir(lock, { recursive: true })
    await writeFile(join(lock, 'owner.pid'), '999999999\n')
    await writeFile(join(lock, 'owner.token'), 'dead-owner\n')

    await execFileAsync('bash', hostLockArgs('expensive-build', 3, ['touch', marker]), {
      env: hostLockEnv(home),
    })

    await expect(readFile(marker, 'utf8')).resolves.toBe('')
  })

  it('reclaims an ownerless lock older than the lease', async () => {
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const marker = join(home, 'ran')
    await mkdir(lock, { recursive: true })
    const old = new Date(Date.now() - 61_000)
    await utimes(lock, old, old)

    await execFileAsync('bash', hostLockArgs('expensive-build', 3, ['touch', marker]), {
      env: hostLockEnv(home),
    })

    await expect(readFile(marker, 'utf8')).resolves.toBe('')
  })

  it('does not reclaim an ownerless lock younger than the lease', async () => {
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const marker = join(home, 'must-not-run')
    await mkdir(lock, { recursive: true })
    const young = new Date(Date.now() - 30_000)
    await utimes(lock, young, young)

    await expect(
      execFileAsync('bash', hostLockArgs('expensive-build', 1, ['touch', marker]), {
        env: hostLockEnv(home),
      }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('not acquired') })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reclaims a lock whose recorded owner is live but whose mtime has outlived the lease', async () => {
    // Owner liveness may only accelerate reclamation, never delay it past the lease: this
    // pins the case a bare liveness check cannot recover from at all -- a recorded owner PID
    // that is technically live (here, this test process itself) but has stopped heartbeating,
    // which is exactly what a reused PID looks like after the real owner has crashed.
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const marker = join(home, 'ran')
    await mkdir(lock, { recursive: true })
    await writeFile(join(lock, 'owner.pid'), `${process.pid}\n`)
    await writeFile(join(lock, 'owner.token'), 'stale-heartbeat\n')
    const old = new Date(Date.now() - 61_000)
    await utimes(lock, old, old)

    await execFileAsync('bash', hostLockArgs('expensive-build', 3, ['touch', marker]), {
      env: hostLockEnv(home),
    })

    await expect(readFile(marker, 'utf8')).resolves.toBe('')
  })

  it('keeps a heartbeating holder past the lease and still lets the next waiter in once it is gone', async () => {
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const nextRan = join(home, 'next-ran')
    const leaseOverride = { HOST_LOCK_LEASE_SECONDS: '4' }

    // Sleep far longer than the observation window below so the assertion can never race
    // the holder's own natural completion -- only the manual kill ends it.
    const holder = spawnHostLock(home, 'expensive-build', 5, ['sleep', '30'], leaseOverride)
    const held = completion(holder)
    await waitForPath(join(lock, 'owner.token'))

    // The lease is 4s (1s heartbeat refresh); wait past two full lease windows while the
    // holder is still alive and heartbeating, and confirm a competing acquisition still
    // fails -- i.e. the heartbeat, not the holder's own liveness, is what keeps the lock
    // held past the lease ceiling.
    await new Promise((resolve) => setTimeout(resolve, 9000))
    await expect(
      execFileAsync('bash', hostLockArgs('expensive-build', 1, ['touch', nextRan]), {
        env: hostLockEnv(home, leaseOverride),
      }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('not acquired') })
    await expect(stat(nextRan)).rejects.toMatchObject({ code: 'ENOENT' })

    holder.kill('SIGTERM')
    await held
    await execFileAsync('bash', hostLockArgs('expensive-build', 3, ['touch', nextRan]), {
      env: hostLockEnv(home, leaseOverride),
    })
    await expect(readFile(nextRan, 'utf8')).resolves.toBe('')
  }, 15_000)

  it('defaults the lease to sixty seconds', async () => {
    const source = await readFile(hostLockScript, 'utf8')
    expect(source).toContain('lease_seconds=${HOST_LOCK_LEASE_SECONDS:-60}')
  })
})
