import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatExitStatus,
  POST_READY_EXIT_MARKER_PREFIX,
  readRecentLog,
  serviceExitMessage,
  startManagedProcess,
  waitForService,
  watchForPostReadyExit,
  type ManagedProcess,
} from './index.mts'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'integration-helpers-proc-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('readRecentLog and exit diagnostics', () => {
  it('reads missing, empty, short, and truncated tail logs', () => {
    const dir = makeTempDir()
    expect(readRecentLog(join(dir, 'missing.log'))).toBe('')

    const empty = join(dir, 'empty.log')
    writeFileSync(empty, '')
    expect(readRecentLog(empty)).toBe('')

    const big = join(dir, 'big.log')
    writeFileSync(big, `${'a'.repeat(100)}TAIL_LINE\n`)
    expect(readRecentLog(big, 15)).toBe('aaaaaTAIL_LINE')
    expect(readRecentLog(big)).toContain('TAIL_LINE')
  })

  it('formats exit statuses, builds startup failure messages, and watches post-ready crashes', async () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'svc.log')
    writeFileSync(logPath, 'boom line\n')

    expect(formatExitStatus({ code: null, error: new Error('ENOENT'), signal: null })).toBe(
      'error ENOENT',
    )
    expect(formatExitStatus({ code: null, signal: 'SIGKILL' })).toBe('signal SIGKILL')
    expect(formatExitStatus({ code: null, signal: null })).toBe('signal unknown')
    expect(formatExitStatus({ code: 2, signal: null })).toBe('code 2')

    const msg = serviceExitMessage('api', 'http://127.0.0.1/ping', logPath, {
      code: 1,
      signal: null,
    })
    expect(msg).toContain('Service api exited with code 1 before becoming ready')
    expect(msg).toContain('boom line')

    const emptyMsg = serviceExitMessage('api', 'http://127.0.0.1/ping', join(dir, 'none.log'), {
      code: 1,
      signal: null,
    })
    expect(emptyMsg).toContain('Recent service log: <empty>')

    // Post-ready watcher writes diagnostic when stop was not requested, stays quiet when stop was requested.
    const crashChunks: string[] = []
    const crashedProc: ManagedProcess = {
      exited: Promise.resolve({ code: 137, signal: null }),
      exitStatus: () => ({ code: 137, signal: null }),
      logPath,
      stop: async () => undefined,
      wasStopRequested: () => false,
    }
    watchForPostReadyExit('worker', crashedProc, (chunk) => crashChunks.push(chunk))
    await crashedProc.exited
    await Promise.resolve()
    expect(crashChunks.join('')).toContain(
      `${POST_READY_EXIT_MARKER_PREFIX} worker exited unexpectedly after ready: code 137`,
    )

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const stoppedProc: ManagedProcess = {
      exited: Promise.resolve({ code: 0, signal: null }),
      exitStatus: () => ({ code: 0, signal: null }),
      logPath,
      stop: async () => undefined,
      wasStopRequested: () => true,
    }
    watchForPostReadyExit('worker', stoppedProc)
    await stoppedProc.exited
    await Promise.resolve()
    expect(stderrSpy).not.toHaveBeenCalled()

    // Default stderr writer runs when stop was not requested.
    watchForPostReadyExit('worker', crashedProc)
    await crashedProc.exited
    await Promise.resolve()
    expect(stderrSpy).toHaveBeenCalled()
  })
})

describe('startManagedProcess and waitForService', () => {
  it('captures stdout/stderr logs, handles clean and non-zero exits, and spawn errors', async () => {
    const dir = makeTempDir()
    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []

    const okProc = startManagedProcess({
      name: 'ok',
      command: process.execPath,
      args: ['-e', 'console.log("hello"); console.error("warn")'],
      cwd: dir,
      logFilePrefix: 'ok',
      logsDir: dir,
      writeStdout: (c) => stdoutChunks.push(c),
      writeStderr: (c) => stderrChunks.push(c),
    })
    const okExit = await okProc.exited
    expect(okExit).toEqual({ code: 0, signal: null })
    expect(okProc.exitStatus()).toEqual({ code: 0, signal: null })
    expect(stdoutChunks.join('')).toContain('[ok] hello')
    expect(stderrChunks.join('')).toContain('[ok] warn')
    expect(readRecentLog(okProc.logPath)).toContain('hello')
    // Stopping an already-exited process is a no-op.
    await okProc.stop()
    expect(okProc.wasStopRequested()).toBe(false)

    // Non-zero exit writes exit message.
    const failStderr: string[] = []
    const failProc = startManagedProcess({
      name: 'fail',
      command: process.execPath,
      args: ['-e', 'process.exit(3)'],
      cwd: dir,
      logFilePrefix: 'fail',
      logsDir: dir,
      writeStdout: () => {},
      writeStderr: (c) => failStderr.push(c),
    })
    const failExit = await failProc.exited
    expect(failExit.code).toBe(3)
    expect(failStderr.join('')).toContain('[fail] exited with code 3')

    // Spawn error (non-existent binary) settles with error, including when stop() runs immediately.
    const errStderr: string[] = []
    const errProc = startManagedProcess({
      name: 'missing-bin',
      command: join(dir, 'does-not-exist-binary'),
      args: [],
      cwd: dir,
      logFilePrefix: 'missing',
      logsDir: dir,
      writeStdout: () => {},
      writeStderr: (c) => errStderr.push(c),
    })
    await errProc.stop()
    const errExit = await errProc.exited
    expect(errExit.error).toBeInstanceOf(Error)
    expect(errStderr.join('')).toContain('[missing] failed to start:')

    // Log stream error (e.g. log path is a directory) reports failure, stops child, and settles without hanging.
    mkdirSync(join(dir, 'dirlog.log'))
    const logErrStderr: string[] = []
    const logErrProc = startManagedProcess({
      name: 'log-err',
      command: process.execPath,
      args: ['-e', 'console.log("ignored"); setTimeout(() => {}, 30000)'],
      cwd: dir,
      logFilePrefix: 'dirlog',
      logsDir: dir,
      forceKillGraceMs: 50,
      writeStdout: () => {},
      writeStderr: (c) => logErrStderr.push(c),
    })
    const logErrExit = await logErrProc.exited
    await logErrProc.stop()
    expect(logErrExit.error).toBeInstanceOf(Error)
    expect(logErrStderr.join('')).toContain('[dirlog] log stream error:')
  })

  it('stops a running process via SIGTERM and escalates to SIGKILL when SIGTERM is ignored', async () => {
    const dir = makeTempDir()
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      // Uses default stdout/stderr writers and waits for both to flush before exiting.
      const defaultIo = startManagedProcess({
        name: 'default-io',
        command: process.execPath,
        args: ['-e', 'console.log("up"); console.error("err")'],
        cwd: dir,
        logFilePrefix: 'default-io',
        logsDir: dir,
      })
      await defaultIo.exited
      expect(stdoutSpy).toHaveBeenCalled()
      expect(stderrSpy).toHaveBeenCalled()

      // Stops a running process on SIGTERM.
      const sleeper = startManagedProcess({
        name: 'sleeper',
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 30000)'],
        cwd: dir,
        logFilePrefix: 'sleeper',
        logsDir: dir,
        writeStdout: () => {},
        writeStderr: () => {},
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
      await sleeper.stop()
      expect(sleeper.wasStopRequested()).toBe(true)
      expect(sleeper.exitStatus()?.signal).toBe('SIGTERM')
    } finally {
      stdoutSpy.mockRestore()
      stderrSpy.mockRestore()
    }

    // Ignores SIGTERM -> force-killed with SIGKILL (also cover process.kill fallback to child.kill).
    const realKill = Reflect.get(process, 'kill') as typeof process.kill
    let threwOnce = false
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid < 0 && !threwOnce) {
        threwOnce = true
        throw new Error('EPERM group kill')
      }
      return Reflect.apply(realKill, process, [pid, signal])
    })
    try {
      const ready = Promise.withResolvers<void>()
      const stubborn = startManagedProcess({
        name: 'stubborn',
        command: process.execPath,
        args: [
          '-e',
          'process.on("SIGTERM", () => {}); console.log("ready"); setTimeout(() => {}, 30000)',
        ],
        cwd: dir,
        logFilePrefix: 'stubborn',
        logsDir: dir,
        forceKillGraceMs: 50,
        writeStdout: (chunk) => {
          if (chunk.includes('ready')) ready.resolve()
        },
        writeStderr: () => {},
      })
      const readyTimeout = setTimeout(
        () => ready.reject(new Error('stubborn ready timeout')),
        5_000,
      )
      try {
        await Promise.race([
          ready.promise,
          stubborn.exited.then(() => {
            throw new Error('stubborn exited before ready')
          }),
        ])
      } finally {
        clearTimeout(readyTimeout)
      }
      await stubborn.stop()
      expect(stubborn.exitStatus()?.signal).toBe('SIGKILL')
      expect(threwOnce).toBe(true)
    } finally {
      killSpy.mockRestore()
    }

    // Wrapper that exits on SIGTERM while a descendant keeps stdout open is still cleaned up via SIGKILL.
    const wrapperReady = Promise.withResolvers<void>()
    const wrapper = startManagedProcess({
      name: 'wrapper',
      command: process.execPath,
      args: [
        '-e',
        'const { spawn } = require("node:child_process"); const child = spawn(process.execPath, ["-e", "process.on(\\"SIGTERM\\", () => {}); console.log(\\"ready\\"); setTimeout(() => {}, 30000)"], { stdio: "inherit" }); process.on("SIGTERM", () => process.exit(0)); setTimeout(() => {}, 30000); void child;',
      ],
      cwd: dir,
      logFilePrefix: 'wrapper',
      logsDir: dir,
      forceKillGraceMs: 50,
      writeStdout: (chunk) => {
        if (chunk.includes('ready')) wrapperReady.resolve()
      },
      writeStderr: () => {},
    })
    const wrapperTimer = setTimeout(
      () => wrapperReady.reject(new Error('wrapper ready timeout')),
      5_000,
    )
    try {
      await Promise.race([
        wrapperReady.promise,
        wrapper.exited.then(() => {
          throw new Error('wrapper exited before ready')
        }),
      ])
    } finally {
      clearTimeout(wrapperTimer)
    }
    await wrapper.stop()
    expect(wrapper.wasStopRequested()).toBe(true)
  })

  it('waits for service readiness with or without a managed process and reports early crash', async () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'early.log')
    writeFileSync(logPath, 'startup error\n')

    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await waitForService('standalone', 'http://127.0.0.1:9/health')

    let resolveExit!: (exit: { code: number | null; signal: NodeJS.Signals | null }) => void
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        resolveExit = resolve
      },
    )
    const healthyProc: ManagedProcess = {
      exited,
      exitStatus: () => null,
      logPath,
      stop: async () => undefined,
      wasStopRequested: () => false,
    }
    const postReadyLogs: string[] = []
    await waitForService('managed', 'http://127.0.0.1:9/health', [200], healthyProc, {
      timeoutMs: 1_000,
      intervalMs: 10,
      write: (chunk) => postReadyLogs.push(chunk),
    })
    // Later crash triggers post-ready diagnostic.
    resolveExit({ code: 1, signal: null })
    await Promise.resolve()
    await Promise.resolve()
    expect(postReadyLogs.join('')).toContain('exited unexpectedly after ready')

    // Process exits before health probe passes -> rejects with serviceExitMessage.
    fetchMock.mockResolvedValue(new Response('not ready', { status: 503 }))
    const crashingProc: ManagedProcess = {
      exited: Promise.resolve({ code: 1, signal: null }),
      exitStatus: () => ({ code: 1, signal: null }),
      logPath,
      stop: async () => undefined,
      wasStopRequested: () => false,
    }
    await expect(
      waitForService('crashing', 'http://127.0.0.1:9/health', [200], crashingProc, {
        timeoutMs: 5_000,
        intervalMs: 10,
      }),
    ).rejects.toThrow('Service crashing exited with code 1 before becoming ready')
  })
})
