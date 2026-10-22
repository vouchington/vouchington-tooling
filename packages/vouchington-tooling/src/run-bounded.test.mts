import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createOutputFixtures } from './test-helpers/run-bounded-output-fixture.test-helpers.mts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(packageRoot, 'scripts/run-bounded.py')
const fixtures = join(packageRoot, 'scripts/run-bounded-fixtures')

function runBounded(seconds: string, command: string[], env?: NodeJS.ProcessEnv) {
  const started = Date.now()
  const result = spawnSync('python3', [script, seconds, ...command], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['pipe', 'ignore', 'ignore'],
    timeout: 7000,
  })
  return { result, elapsedMs: Date.now() - started }
}

function killProcessGroup(pidFile: string) {
  if (!existsSync(pidFile)) return
  const pid = Number(readFileSync(pidFile, 'utf8').trim())
  if (!Number.isInteger(pid)) return
  const result = spawnSync('python3', [
    '-c',
    [
      'import os, signal, sys',
      'pgid = int(sys.argv[1])',
      'if pgid == os.getpgrp(): raise SystemExit("refusing to kill the test process group")',
      'try: os.killpg(pgid, signal.SIGKILL)',
      'except ProcessLookupError: pass',
    ].join('\n'),
    String(pid),
  ])
  if (result.status !== 0) throw new Error('Failed to clean up the fixture process group')
}

describe('run-bounded', () => {
  it('reports 128 plus the signal when the command dies from a signal', () => {
    const { result } = runBounded('5', [
      'python3',
      '-c',
      'import os, signal; os.kill(os.getpid(), signal.SIGTERM)',
    ])

    expect(result.status).toBe(143)
  })

  it('kills the command group when the wrapper receives SIGTERM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-bounded-signal-'))
    const pidFile = join(dir, 'child-pid')
    const child = spawn(
      'python3',
      [script, '30', 'bash', '-c', 'echo $$ > "$PID_FILE"; exec sleep 30'],
      { env: { ...process.env, PID_FILE: pidFile }, stdio: 'ignore' },
    )
    try {
      const started = Date.now()
      while (!existsSync(pidFile)) {
        if (child.exitCode !== null) throw new Error(`wrapper exited early: ${child.exitCode}`)
        if (Date.now() - started > 3000) throw new Error('child did not start')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      child.kill('SIGTERM')
      const status = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('wrapper did not exit')), 5000)
        child.once('close', (code) => {
          clearTimeout(timer)
          resolve(code)
        })
      })
      expect(status).toBe(143)
      const pid = readFileSync(pidFile, 'utf8').trim()
      expect(spawnSync('kill', ['-0', pid]).status).not.toBe(0)
    } finally {
      child.kill('SIGKILL')
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns the command status when the command finishes inside the deadline', () => {
    const { result, elapsedMs } = runBounded('5', ['python3', '-c', 'raise SystemExit(3)'])

    expect(result.status).toBe(3)
    expect(elapsedMs).toBeLessThan(5000)
  })

  it('kills the command and its children when the deadline expires', () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-bounded-'))
    const pidFile = join(dir, 'child-pid')
    const groupPidFile = join(dir, 'group-pid')
    try {
      const { result, elapsedMs } = runBounded(
        '1',
        ['bash', '-c', 'echo $$ > "$GROUP_PID_FILE"; sleep 30 & echo $! > "$PID_FILE"; wait'],
        { GROUP_PID_FILE: groupPidFile, PID_FILE: pidFile },
      )

      expect(result.status).toBe(124)
      expect(elapsedMs).toBeLessThan(8000)
      const pid = Number(readFileSync(pidFile, 'utf8').trim())
      expect(Number.isInteger(pid)).toBe(true)
      const state = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' })
      expect(state.stdout.trim() === '' || state.stdout.trim().startsWith('Z')).toBe(true)
    } finally {
      killProcessGroup(groupPidFile)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('kills a TERM-resistant descendant when the wrapper receives SIGTERM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-bounded-signal-'))
    const pidFile = join(dir, 'child-pid')
    const groupPidFile = join(dir, 'group-pid')
    const child = [
      'import os, signal',
      'signal.signal(signal.SIGTERM, signal.SIG_IGN)',
      'open(os.environ["PID_FILE"], "w").write(str(os.getpid()))',
      'signal.pause()',
    ].join('; ')
    const parent = [
      'import os, signal, subprocess, sys',
      'open(os.environ["GROUP_PID_FILE"], "w").write(str(os.getpid()))',
      `subprocess.Popen([sys.executable, "-c", ${JSON.stringify(child)}], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)`,
      'signal.pause()',
    ].join('; ')
    const wrapper = spawn('python3', [script, '30', 'python3', '-c', parent], {
      env: { ...process.env, PID_FILE: pidFile, GROUP_PID_FILE: groupPidFile },
      stdio: 'ignore',
    })
    try {
      const started = Date.now()
      while (!existsSync(pidFile)) {
        if (wrapper.exitCode !== null) throw new Error(`wrapper exited early: ${wrapper.exitCode}`)
        if (Date.now() - started > 3000) throw new Error('descendant did not start')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      wrapper.kill('SIGTERM')
      const status = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('wrapper did not exit')), 15000)
        wrapper.once('close', (code) => {
          clearTimeout(timer)
          resolve(code)
        })
      })
      expect(status).toBe(143)
      const pid = Number(readFileSync(pidFile, 'utf8').trim())
      const state = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' })
      expect(state.stdout.trim() === '' || state.stdout.trim().startsWith('Z')).toBe(true)
    } finally {
      wrapper.kill('SIGKILL')
      killProcessGroup(groupPidFile)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('kills a TERM-resistant child even when its parent exits on TERM', () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-bounded-'))
    const pidFile = join(dir, 'child-pid')
    const groupPidFile = join(dir, 'group-pid')
    const child = [
      'import os, signal',
      'signal.signal(signal.SIGTERM, signal.SIG_IGN)',
      'open(os.environ["PID_FILE"], "w").write(str(os.getpid()))',
      'signal.pause()',
    ].join('; ')
    const parent = [
      'import os, signal, subprocess, sys',
      'open(os.environ["GROUP_PID_FILE"], "w").write(str(os.getpid()))',
      `subprocess.Popen([sys.executable, "-c", ${JSON.stringify(child)}], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)`,
      'signal.pause()',
    ].join('; ')
    try {
      const { result, elapsedMs } = runBounded('1', ['python3', '-c', parent], {
        GROUP_PID_FILE: groupPidFile,
        PID_FILE: pidFile,
      })
      const pid = Number(readFileSync(pidFile, 'utf8').trim())
      expect(result.status).toBe(124)
      expect(elapsedMs).toBeLessThan(8000)
      const state = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' })
      expect(state.stdout.trim() === '' || state.stdout.trim().startsWith('Z')).toBe(true)
    } finally {
      killProcessGroup(groupPidFile)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('run-bounded output pipes', () => {
  const fixtures = createOutputFixtures(script)
  afterEach(() => fixtures.cleanup())

  it('reaches EOF after the command exits even if a detached descendant holds stdout', async () => {
    const { code, stdout, stderr } = await (await fixtures.launch('30', 'exit')).result

    expect(code).toBe(0)
    expect(stdout).toBe('out\n')
    expect(stderr).toBe('err\n')
  }, 30_000)

  it('reaches EOF with status 124 after a deadline even if a detached descendant holds stdout', async () => {
    const { code, stdout, stderr } = await (await fixtures.launch('1', 'hang')).result

    expect(code).toBe(124)
    expect(stdout).toBe('out\n')
    expect(stderr).toBe('err\n')
  }, 30_000)

  it('drains the command and detached descendant when cleanup interrupts a hanging case', async () => {
    const fixture = await fixtures.launch('30', 'hang')
    await fixture.started
    expect(fixture.wrapperRunning()).toBe(true)
    expect(fixture.commandOpen()).toBe(true)
    expect(fixture.descendantOpen()).toBe(true)

    await fixtures.cleanup()
    const { code, stdout, stderr } = await fixture.result
    await fixture.commandClosed
    await fixture.descendantClosed
    await fixture.wrapperClosed
    expect(code).toBe(0)
    expect(stdout).toBe('out\n')
    expect(stderr).toBe('err\n')
    expect(fixture.wrapperRunning()).toBe(false)
    expect(fixture.commandOpen()).toBe(false)
    expect(fixture.descendantOpen()).toBe(false)
    expect(existsSync(fixture.dir)).toBe(false)
  })
})

describe('run-bounded downstream backpressure', () => {
  it('drains buffered output after source closure before returning the command status', async () => {
    const child = spawn('python3', [join(fixtures, 'run-bounded-backpressure.py'), script])
    let stdout = ''
    let stderr = ''
    let observedError: Error | undefined
    const recordError = (err: Error) => {
      observedError ??= err
    }
    child.stdin.on('error', recordError)
    child.stdout.on('data', (data) => {
      stdout += data
    })
    child.stderr.on('data', (data) => {
      stderr += data
    })
    const closed = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    void closed.catch(recordError)
    onTestFinished(async () => {
      child.stdin.end()
      await closed
      if (observedError) throw observedError
    })
    expect(await closed).toBe(0)
    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual({
      status: 3,
      stdout: `${'a'.repeat(8191)}z${'b'.repeat(4095)}y`,
      sourceHolderStatus: 0,
      wrapperDrained: true,
    })
  }, 30_000)
})

describe('run-bounded absent downstream descriptors', () => {
  it.each([
    ['stdout', '1>&-', '', 'err\n'],
    ['stderr', '2>&-', 'out\n', ''],
    ['both', '1>&- 2>&-', '', ''],
  ])('preserves command status when %s is closed at entry', (_name, redirects, stdout, stderr) => {
    const command = 'import os; os.write(1, b"out\\n"); os.write(2, b"err\\n"); raise SystemExit(3)'
    const result = spawnSync(
      'bash',
      ['-c', `exec python3 "$1" 5 python3 -c "$2" ${redirects}`, 'fixture', script, command],
      {
        encoding: 'utf8',
        timeout: 7000,
      },
    )
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(3)
    expect(result.stdout).toBe(stdout)
    expect(result.stderr).toBe(stderr)
  })
})
