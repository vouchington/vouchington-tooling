import { readFile, stat, writeFile } from 'node:fs/promises'
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

describe('with-host-lock.sh signals and ownership', () => {
  afterEach(cleanupTestHomes)

  it.each([
    { expected: 'term', signal: 'SIGTERM' as const },
    { expected: 'int', signal: 'SIGINT' as const },
  ])('holds the lock until the command exits after $signal', async ({ expected, signal }) => {
    const home = await makeHome()
    const ready = join(home, 'ready')
    const signalled = join(home, 'signalled')
    const contenderEntered = join(home, 'contender-entered')
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const child = spawnHostLock(home, 'expensive-build', 5, [
      'bash',
      '-c',
      'trap \'printf int > "$1"; sleep 1; exit 43\' INT; trap \'printf term > "$1"; sleep 1; exit 42\' TERM; touch "$2"; while :; do sleep 1; done',
      'host-lock-test',
      signalled,
      ready,
    ])
    const done = completion(child)
    await waitForPath(ready)

    child.kill(signal)
    await waitForPath(signalled)
    const contender = completion(
      spawnHostLock(home, 'expensive-build', 5, ['touch', contenderEntered]),
    )
    await new Promise((resolve) => setTimeout(resolve, 250))
    await expect(stat(contenderEntered)).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const result = await Promise.race([
      done,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 3e3)),
    ])
    if (result === 'timeout') {
      child.kill('SIGTERM')
      await done
    }

    expect(result).not.toBe('timeout')
    await expect(readFile(signalled, 'utf8')).resolves.toBe(expected)
    await expect(contender).resolves.toEqual({
      code: 0,
      stderr: expect.stringMatching(/^with-host-lock: expensive-build acquired after \d+s\n$/),
    })
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the command as lock owner if the wrapper is killed', async () => {
    const home = await makeHome()
    const ready = join(home, 'ready')
    const commandPidFile = join(home, 'command-pid')
    const marker = join(home, 'must-not-run')
    const recoveredMarker = join(home, 'recovered')
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const wrapper = spawnHostLock(home, 'expensive-build', 5, [
      'bash',
      '-c',
      String.raw`exec >/dev/null 2>&1; trap 'exit 0' TERM; printf '%s\n' "$$" > "$1"; touch "$2"; while :; do :; done`,
      'host-lock-test',
      commandPidFile,
      ready,
    ])
    const wrapperDone = completion(wrapper)
    await waitForPath(ready)
    const commandPid = (await readFile(commandPidFile, 'utf8')).trim()

    wrapper.kill('SIGKILL')
    await wrapperDone
    try {
      await expect(readFile(join(lock, 'owner.pid'), 'utf8')).resolves.toBe(`${commandPid}\n`)
      await expect(
        execFileAsync('bash', hostLockArgs('expensive-build', 1, ['touch', marker]), {
          env: hostLockEnv(home),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('not acquired'),
      })
      await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })

      await execFileAsync('kill', ['-s', 'TERM', commandPid])
      await new Promise((resolve) => setTimeout(resolve, 100))
      await execFileAsync('bash', hostLockArgs('expensive-build', 3, ['touch', recoveredMarker]), {
        env: hostLockEnv(home),
      })
      await expect(readFile(recoveredMarker, 'utf8')).resolves.toBe('')
    } finally {
      try {
        await execFileAsync('kill', ['-s', 'TERM', commandPid])
      } catch {
        // The command already exited after the successful recovery path.
      }
    }
  })

  it('records the child owner before releasing its start barrier', async () => {
    const source = await readFile(hostLockScript, 'utf8')
    const ownerWrite = source.indexOf('>"$lock_dir/owner.pid"')
    const releaseWrite = source.indexOf('>"$start_release"')

    expect(ownerWrite).toBeGreaterThan(-1)
    expect(releaseWrite).toBeGreaterThan(ownerWrite)
    expect(source).toContain('kill -0 "$wrapper_pid"')
  })

  it('holds the lock until a signalled process-group descendant exits', async () => {
    const home = await makeHome()
    const rootReady = join(home, 'root-ready')
    const descendantReady = join(home, 'descendant-ready')
    const descendantSignalled = join(home, 'descendant-signalled')
    const contenderEntered = join(home, 'contender-entered')
    const descendantScript = join(home, 'descendant.sh')
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    await writeFile(
      descendantScript,
      `#!/usr/bin/env bash
signal_file=$1
ready_file=$2
trap 'touch "$signal_file"; sleep 1; exit 0' TERM INT
touch "$ready_file"
while :; do :; done
`,
    )
    const wrapper = spawnHostLock(home, 'expensive-build', 5, [
      'bash',
      '-c',
      `trap 'exit 0' TERM INT
bash "$1" "$2" "$3" &
touch "$4"
while :; do :; done`,
      'host-lock-root',
      descendantScript,
      descendantSignalled,
      descendantReady,
      rootReady,
    ])
    const wrapperDone = completion(wrapper)
    await waitForPath(rootReady)
    await waitForPath(descendantReady)
    const processGroup = Number((await readFile(join(lock, 'owner.pid'), 'utf8')).trim())
    let contender: Promise<{ code: number | null; stderr: string }> | undefined

    try {
      wrapper.kill('SIGTERM')
      await waitForPath(descendantSignalled)
      contender = completion(spawnHostLock(home, 'expensive-build', 5, ['touch', contenderEntered]))
      await new Promise((resolve) => setTimeout(resolve, 250))
      await expect(stat(contenderEntered)).rejects.toMatchObject({
        code: 'ENOENT',
      })
      await expect(wrapperDone).resolves.toMatchObject({
        code: expect.any(Number),
      })
      await expect(contender).resolves.toEqual({
        code: 0,
        stderr: expect.stringMatching(/^with-host-lock: expensive-build acquired after \d+s\n$/),
      })
    } finally {
      try {
        await execFileAsync('kill', ['-s', 'KILL', '--', String(-processGroup)])
      } catch {
        // The process group already exited through the successful signal path.
      }
      wrapper.kill('SIGKILL')
      await wrapperDone
      if (contender) await contender
    }
  })

  it('terminates a lingering process group after the bounded drain period', async () => {
    const home = await makeHome()
    const descendantReady = join(home, 'descendant-ready')
    const descendantSignalled = join(home, 'descendant-signalled')
    const descendantScript = join(home, 'lingering-descendant.sh')
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    await writeFile(
      descendantScript,
      `#!/usr/bin/env bash
signal_file=$1
ready_file=$2
trap 'touch "$signal_file"; exit 0' TERM
touch "$ready_file"
while :; do sleep 1; done
`,
    )
    const wrapper = spawnHostLock(
      home,
      'expensive-build',
      5,
      [
        'bash',
        '-c',
        'bash "$1" "$2" "$3" & while [ ! -f "$3" ]; do sleep 0.05; done',
        'host-lock-root',
        descendantScript,
        descendantSignalled,
        descendantReady,
      ],
      { HOST_LOCK_PROCESS_GROUP_DRAIN_SECONDS: '0' },
    )

    await expect(completion(wrapper)).resolves.toEqual({
      code: 0,
      stderr: expect.stringContaining('command left processes running'),
    })
    await expect(readFile(descendantSignalled, 'utf8')).resolves.toBe('')
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('kills a lingering process group that ignores SIGTERM', async () => {
    const home = await makeHome()
    const descendantReady = join(home, 'descendant-ready')
    const descendantPidFile = join(home, 'descendant-pid')
    const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
    const wrapper = spawnHostLock(
      home,
      'expensive-build',
      5,
      [
        'bash',
        '-c',
        `bash -c 'trap "" TERM; printf "%s\\n" "$$" > "$1"; touch "$2"; while :; do sleep 1; done' descendant "$1" "$2" & while [ ! -f "$2" ]; do sleep 0.05; done`,
        'host-lock-root',
        descendantPidFile,
        descendantReady,
      ],
      { HOST_LOCK_PROCESS_GROUP_DRAIN_SECONDS: '0' },
    )

    await expect(completion(wrapper)).resolves.toEqual({
      code: 0,
      stderr: expect.stringContaining('command left processes running'),
    })
    const descendantPid = (await readFile(descendantPidFile, 'utf8')).trim()
    await expect(execFileAsync('kill', ['-0', descendantPid])).rejects.toMatchObject({ code: 1 })
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15_000)

  it('retains ownership when the process group cannot be killed', async () => {
    const source = await readFile(hostLockScript, 'utf8')
    const failure = source.indexOf('process group survived SIGKILL; retaining lock ownership')
    const retainOwnership = source.indexOf('acquired=0', failure)
    const failedExit = source.indexOf('exit 1', retainOwnership)

    expect(failure).toBeGreaterThan(-1)
    expect(retainOwnership).toBeGreaterThan(failure)
    expect(failedExit).toBeGreaterThan(retainOwnership)
  })
})
