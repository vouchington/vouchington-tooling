import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  cleanupTestHomes,
  execFileAsync,
  hostLockArgs,
  hostLockEnv,
  hostLockScript,
  makeHome,
} from './with-host-lock.test-helpers.mts'

describe('with-host-lock.sh filesystem safety', () => {
  afterEach(cleanupTestHomes)

  it('rejects a symbolic-link lock root without running the command', async () => {
    const home = await makeHome()
    const realRoot = join(home, 'real-lock-root')
    const linkedRoot = join(home, 'linked-lock-root')
    const marker = join(home, 'must-not-run')
    await mkdir(realRoot)
    await symlink(realRoot, linkedRoot)

    await expect(
      execFileAsync('bash', hostLockArgs('build', 1, ['touch', marker]), {
        env: hostLockEnv(home, { HOST_LOCK_ROOT: linkedRoot }),
      }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('symbolic link') })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['owner.pid', 'owner.pgid'])(
    'preserves the grace period while %s contains a partial write',
    async (ownerFile) => {
      const home = await makeHome()
      const lock = join(home, '.cache/host-lock/build.lock.d')
      const marker = join(home, 'must-not-run')
      await mkdir(lock, { recursive: true })
      await writeFile(join(lock, ownerFile), '')

      await expect(
        execFileAsync('bash', hostLockArgs('build', 1, ['touch', marker]), {
          env: hostLockEnv(home),
        }),
      ).rejects.toMatchObject({ stderr: expect.stringContaining('not acquired') })
      await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(lock)).resolves.toBeDefined()
    },
  )

  it('treats permission denial as live and uses ps for ambiguous probes', async () => {
    const source = await readFile(hostLockScript, 'utf8')

    expect(source).toContain('*[Oo]peration*not*permitted* | *[Pp]ermission*denied*) return 0')
    expect(source).toContain('ps -p "$candidate_pid" -o pid=')
    expect(source).toContain('ps -e -o pgid=')
    expect(source).toContain('while process_group_is_live "$child_pid"; do')
  })
})
