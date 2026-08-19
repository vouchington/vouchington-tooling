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
} from './with-host-lock.test-helpers.mts'

describe('with-host-lock.sh', () => {
  afterEach(async () => {
    await cleanupTestHomes()
  })

  it.each([
    { args: [], message: 'usage' },
    {
      args: ['--name', '../escape', '--timeout-seconds', '1', '--', 'true'],
      message: 'name',
    },
    {
      args: ['--name', 'build', '--timeout-seconds', '0', '--', 'true'],
      message: 'positive',
    },
    {
      args: [
        '--name',
        'build',
        '--timeout-seconds',
        '1',
        '--failure-diagnostics',
        'relative.sh',
        '--',
        'true',
      ],
      message: 'absolute',
    },
    {
      args: ['--name', 'build', '--timeout-seconds', '1', '--'],
      message: 'command',
    },
  ])('rejects invalid invocation: $message', async ({ args, message }) => {
    const home = await makeHome()

    await expect(
      execFileAsync('bash', [hostLockScript, ...args], {
        env: hostLockEnv(home),
      }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining(message) })
  })

  it('requires an absolute configured root instead of silently changing lock scope', async () => {
    await expect(
      execFileAsync('bash', hostLockArgs('build', 1, ['true']), {
        env: {
          PATH: process.env.PATH ?? '',
          HOST_LOCK_ROOT: 'relative-lock-root',
        },
      }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('absolute') })
  })

  it('defaults to a stable UID-scoped /tmp root', async () => {
    const home = await makeHome()
    const marker = join(home, 'ran')
    const lockRoot = join('/tmp', `host-lock-${process.getuid?.() ?? 0}`)
    const lockName = `default-root-test-${process.pid}`

    await execFileAsync('bash', hostLockArgs(lockName, 1, ['touch', marker]), {
      env: {
        ...process.env,
        HOME: home,
        HOST_LOCK_ROOT: '',
      },
    })

    await expect(readFile(marker, 'utf8')).resolves.toBe('')
    const lockRootStat = await stat(lockRoot)
    expect(lockRootStat.mode & 0o777).toBe(0o700)
  })

  it('serializes callers of the same lock family', async () => {
    const home = await makeHome()
    const guard = join(home, 'critical-section')
    const command = [
      'bash',
      '-c',
      'mkdir "$1" || exit 91; sleep 0.3; rmdir "$1"',
      'host-lock-test',
      guard,
    ]

    const first = completion(spawnHostLock(home, 'expensive-build', 5, command))
    const second = completion(spawnHostLock(home, 'expensive-build', 5, command))
    const acquired = expect.stringMatching(
      /^with-host-lock: expensive-build acquired after \d+s\n$/,
    )

    await expect(Promise.all([first, second])).resolves.toEqual([
      { code: 0, stderr: acquired },
      { code: 0, stderr: acquired },
    ])
  })

  it('serializes the same OS user across runner-specific TMPDIR values', async () => {
    const home = await makeHome()
    const guard = join(home, 'cross-runner-critical-section')
    const lockName = `cross-runner-test-${process.pid}`
    const command = [
      'bash',
      '-c',
      'mkdir "$1" || exit 91; sleep 0.3; rmdir "$1"',
      'host-lock-test',
      guard,
    ]
    const defaultRoot = { HOST_LOCK_ROOT: '' }

    const first = completion(
      spawnHostLock(home, lockName, 5, command, {
        ...defaultRoot,
        TMPDIR: join(home, 'runner-1'),
      }),
    )
    const second = completion(
      spawnHostLock(home, lockName, 5, command, {
        ...defaultRoot,
        TMPDIR: join(home, 'runner-2'),
      }),
    )
    const acquired = expect.stringMatching(
      new RegExp(`^with-host-lock: ${lockName} acquired after \\d+s\\n$`),
    )

    await expect(Promise.all([first, second])).resolves.toEqual([
      { code: 0, stderr: acquired },
      { code: 0, stderr: acquired },
    ])
  })

  it('allows separate lock families to run concurrently', async () => {
    const home = await makeHome()
    const firstReady = join(home, 'first-ready')
    const secondReady = join(home, 'second-ready')
    const rendezvous = [
      'bash',
      '-c',
      'touch "$1"; i=0; while [ ! -e "$2" ] && [ "$i" -lt 100 ]; do sleep 0.02; i=$((i + 1)); done; [ -e "$2" ]',
      'host-lock-test',
    ]

    const first = completion(
      spawnHostLock(home, 'expensive-build', 5, [...rendezvous, firstReady, secondReady]),
    )
    const second = completion(
      spawnHostLock(home, 'host-package-manager', 5, [...rendezvous, secondReady, firstReady]),
    )

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        code: 0,
        stderr: expect.stringMatching(/^with-host-lock: expensive-build acquired after \d+s\n$/),
      },
      {
        code: 0,
        stderr: expect.stringMatching(
          /^with-host-lock: host-package-manager acquired after \d+s\n$/,
        ),
      },
    ])
  })

  it.each([
    { innerName: 'expensive-build', innerSlots: [] },
    { innerName: 'host-package-manager', innerSlots: [] },
    { innerName: 'memory-heavy', innerSlots: ['--slots', '1'] },
  ])('rejects a descendant attempt to acquire $innerName', async ({ innerName, innerSlots }) => {
    const home = await makeHome()
    const marker = join(home, 'nested-ran')
    const nestedCommand = [
      'bash',
      hostLockScript,
      '--name',
      innerName,
      ...innerSlots,
      '--timeout-seconds',
      '1',
      '--',
      'touch',
      marker,
    ]

    await expect(
      execFileAsync('bash', hostLockArgs('expensive-build', 3, nestedCommand), {
        env: hostLockEnv(home),
      }),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('nested host locks are not allowed'),
    })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('snapshots reaper ownership before checking whether that observation is stale', async () => {
    const source = await readFile(hostLockScript, 'utf8')
    const recoverStart = source.indexOf('recover_stale_reaper()')
    const recoverEnd = source.indexOf('\n}\n\nreclaim_stale_lock()', recoverStart)
    const recoverSource = source.slice(recoverStart, recoverEnd)
    const observedPid = recoverSource.indexOf('stale_reaper_pid=')
    const staleCheck = recoverSource.indexOf('owned_directory_is_stale "$reap_dir" 10')
    const currentPid = recoverSource.indexOf('current_reaper_pid=')

    expect(observedPid).toBeGreaterThan(-1)
    expect(staleCheck).toBeGreaterThan(observedPid)
    expect(currentPid).toBeGreaterThan(staleCheck)
  })

  it('rejects an inherited active-lock marker before it can acquire a lock', async () => {
    const home = await makeHome()
    const marker = join(home, 'must-not-run')

    await expect(
      execFileAsync('bash', hostLockArgs('expensive-build', 1, ['touch', marker]), {
        env: hostLockEnv(home, { HOST_LOCK_ACTIVE: '1' }),
      }),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('nested host locks are not allowed'),
    })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    { metadata: 'dead-owner', ownerPid: '999999999' },
    { metadata: 'ownerless', ownerPid: undefined },
  ])('recovers a stranded $metadata reaper mutex', async ({ ownerPid }) => {
    const home = await makeHome()
    const reaper = join(home, '.cache/host-lock/expensive-build.lock.reap.d')
    const marker = join(home, 'ran')
    await mkdir(reaper, { recursive: true })
    if (ownerPid) {
      await writeFile(join(reaper, 'owner.pid'), `${ownerPid}\n`)
      await writeFile(join(reaper, 'owner.token'), 'stranded-reaper\n')
    } else {
      const old = new Date(Date.now() - 11_000)
      await utimes(reaper, old, old)
    }

    await execFileAsync('bash', hostLockArgs('expensive-build', 3, ['touch', marker]), {
      env: hostLockEnv(home),
    })

    await expect(readFile(marker, 'utf8')).resolves.toBe('')
  })

  it('preserves command status and removes the owned lock', async () => {
    const home = await makeHome()
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')

    await expect(
      execFileAsync('bash', hostLockArgs('expensive-build', 1, ['bash', '-c', 'exit 37']), {
        env: hostLockEnv(home),
      }),
    ).rejects.toMatchObject({ code: 37 })
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
