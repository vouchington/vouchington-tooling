import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { observeFixtureExit } from './run-bounded-exit-observer.test-helpers.mts'

type Fixture = {
  dir: string
  command: ReturnType<typeof observeFixtureExit>
  descendant: ReturnType<typeof observeFixtureExit>
  child?: ChildProcessWithoutNullStreams
  wrapperClosed?: Promise<void>
  observedError?: unknown
}

export function createOutputFixtures(script: string) {
  const fixtures: Fixture[] = []
  async function cleanup() {
    const outcomes = await Promise.allSettled(
      fixtures.map(async (fixture) => {
        const errors: unknown[] = []
        try {
          fixture.child?.stdin.end()
        } catch (err) {
          errors.push(err)
          fixture.child?.stdin.destroy()
        }
        try {
          await fixture.wrapperClosed
        } catch (err) {
          errors.push(err)
        }
        if (fixture.child) {
          for (const observer of [fixture.command, fixture.descendant]) {
            if (!observer.connected())
              errors.push(new Error('Owned process startup/exit was not observed'))
            else await observer.closed
            if (observer.error()) errors.push(observer.error())
          }
        }
        const closures = await Promise.allSettled([
          fixture.command.closeListener(),
          fixture.descendant.closeListener(),
        ])
        for (const closure of closures)
          if (closure.status === 'rejected') errors.push(closure.reason)
        if (fixture.observedError) errors.unshift(fixture.observedError)
        if (errors.length)
          throw new AggregateError(errors, 'Owned fixture disposal failed', { cause: errors[0] })
        rmSync(fixture.dir, { recursive: true, force: true })
        fixtures.splice(fixtures.indexOf(fixture), 1)
      }),
    )
    const errors = outcomes.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    )
    if (errors.length)
      throw new AggregateError(errors, 'Fixture cleanup failed', { cause: errors[0] })
  }

  async function launch(seconds: string, mode: 'exit' | 'hang') {
    const dir = mkdtempSync(join(tmpdir(), 'run-bounded-'))
    const fixture: Fixture = {
      dir,
      command: observeFixtureExit(join(dir, 'command.sock')),
      descendant: observeFixtureExit(join(dir, 'exit.sock')),
    }
    fixtures.push(fixture)
    const observeError = (error: unknown) => {
      fixture.observedError ??= error
    }
    const starts = await Promise.allSettled([fixture.command.listen(), fixture.descendant.listen()])
    const failures = starts.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    )
    if (failures.length)
      throw new AggregateError(failures, 'Fixture listener setup failed', { cause: failures[0] })
    const stopAtEof = [
      'import os, sys, threading',
      'def stop_at_eof():',
      '    while os.read(0, 4096): pass',
      '    os._exit(0)',
      'threading.Thread(target=stop_at_eof, daemon=True).start()',
    ].join('\n')
    const grandchild = [
      'import socket, signal',
      'exit_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
      'exit_socket.connect(os.environ["EXIT_SOCKET"])',
      'exit_socket.sendall(b"ready\\n")',
      'os.write(int(os.environ["READY_FD"]), b"ready"); os.close(int(os.environ["READY_FD"]))',
      stopAtEof,
      'signal.pause()',
    ].join('\n')
    const command = [
      'import os, socket',
      'command_exit = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
      'command_exit.connect(os.environ["COMMAND_SOCKET"])',
      'command_exit.sendall(b"ready\\n")',
      stopAtEof,
      'import signal, subprocess',
      'ready_read, ready_write = os.pipe()',
      `subprocess.Popen([sys.executable, "-c", ${JSON.stringify(`import os\n${grandchild}`)}], start_new_session=True, stderr=subprocess.DEVNULL, env={**os.environ, "READY_FD": str(ready_write)}, pass_fds=(ready_write,))`,
      'os.close(ready_write); assert os.read(ready_read, 5) == b"ready"; os.close(ready_read)',
      'sys.stdout.write("out\\n"); sys.stdout.flush()',
      'sys.stderr.write("err\\n"); sys.stderr.flush()',
      'if os.environ["MODE"] == "hang": signal.pause()',
    ].join('\n')
    const child = spawn('python3', [script, seconds, 'python3', '-c', command], {
      env: {
        ...process.env,
        EXIT_SOCKET: join(dir, 'exit.sock'),
        COMMAND_SOCKET: join(dir, 'command.sock'),
        MODE: mode,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdin.on('error', observeError)
    fixture.child = child
    fixture.wrapperClosed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    let stdout = ''
    let stderr = ''
    let outputReady: () => void = () => {}
    let failOutput: (error: Error) => void = () => {}
    const output = new Promise<void>((resolve, reject) => {
      outputReady = resolve
      failOutput = reject
    })
    const readyIfComplete = () => {
      if (stdout.includes('out\n') && stderr.includes('err\n')) outputReady()
    }
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      readyIfComplete()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      readyIfComplete()
    })
    const result = new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        child.once('error', (error) => {
          failOutput(error)
          fixture.descendant.failStartup(error)
          fixture.command.failStartup(error)
          reject(error)
        })
        child.once('close', (code) => {
          if (!stdout.includes('out\n') || !stderr.includes('err\n'))
            failOutput(new Error('Wrapper closed before output readiness'))
          if (!fixture.descendant.connected())
            fixture.descendant.failStartup(new Error('Wrapper closed before descendant readiness'))
          if (!fixture.command.connected())
            fixture.command.failStartup(new Error('Wrapper closed before command readiness'))
          resolve({ code, stdout, stderr })
        })
      },
    )
    const started = Promise.all([fixture.descendant.started, fixture.command.started, output]).then(
      () => undefined,
    )
    void result.catch(observeError)
    void started.catch(observeError)
    return {
      result,
      started,
      dir,
      descendantClosed: fixture.descendant.closed,
      commandClosed: fixture.command.closed,
      wrapperClosed: fixture.wrapperClosed,
      wrapperRunning: () => child.exitCode === null,
      commandOpen: fixture.command.open,
      descendantOpen: fixture.descendant.open,
    }
  }
  return { cleanup, launch }
}
