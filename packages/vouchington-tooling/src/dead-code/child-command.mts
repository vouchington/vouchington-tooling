import { spawn } from 'node:child_process'

export class ChildCommandCleanupError extends AggregateError {
  readonly processGroupId: number
  readonly completion: Promise<Error | null>

  constructor(processGroupId: number, completion: Promise<Error | null>, errors: unknown[]) {
    super(errors, 'Child command cleanup failed; owned process group may still be live', {
      cause: errors[0],
    })
    this.processGroupId = processGroupId
    this.completion = completion
  }
}

class ChildCommandFailure extends Error {
  readonly code: number | null
  constructor(file: string, code: number | null, signal: NodeJS.Signals | null, stderr: string) {
    super(`Command failed: ${file} (${signal ?? code}): ${stderr}`)
    this.code = code
  }
}

// Finite fixtures opt into a deadline; repository scans retain no local cap.
export async function runChildCommand(
  file: string,
  args: string[],
  cwd: string,
  remaining?: () => number,
): Promise<void> {
  const timeout = remaining?.()
  await new Promise<void>((resolve, reject) => {
    let settleCapture: (error: Error | null) => void = () => undefined
    const capture = new Promise<Error | null>((done) => {
      settleCapture = done
    })
    let expired = false
    let settled = false
    let failure: Error | null = null
    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let bytes = 0
    let stderr = ''
    const child = spawn(file, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    function stopGroup() {
      if (settled || child.pid === undefined) return
      try {
        // eslint-disable-next-line no-restricted-properties -- terminate only this command's detached group, never the application process
        process.kill(-child.pid, 'SIGKILL')
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ESRCH') return
        settled = true
        clearTimeout(timer)
        const errors: unknown[] = failure ? [failure, err] : [err]
        child.stdout.destroy()
        child.stderr.destroy()
        reject(new ChildCommandCleanupError(child.pid, capture, errors))
      }
    }
    function output(chunk: Buffer, isError: boolean) {
      bytes += chunk.length
      if (bytes > 8 * 1024 * 1024) {
        // Signal once: a later signal can hit the already-exited group leader and fail with EPERM.
        if (failure !== null) return
        failure = new Error('Child command output exceeded maxBuffer')
        stopGroup()
      } else if (isError) stderr += chunk.toString('utf8')
    }
    child.stdout.on('data', (chunk: Buffer) => output(chunk, false))
    child.stderr.on('data', (chunk: Buffer) => output(chunk, true))
    child.once('error', (err) => {
      failure ??= err
    })
    child.once('spawn', () => {
      if (expired) stopGroup()
    })
    child.once('exit', (code, signal) => {
      exit = { code, signal }
      stopGroup()
    })
    child.once('close', (code, signal) => {
      const outcome = exit ?? { code, signal }
      const commandFailure =
        outcome.code === 0
          ? null
          : new ChildCommandFailure(file, outcome.code, outcome.signal, stderr)
      if (commandFailure && failure && commandFailure !== failure) {
        failure = new AggregateError([failure, commandFailure], failure.message, { cause: failure })
      } else failure ??= commandFailure
      settleCapture(failure)
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (failure) reject(failure)
      else resolve()
    })
    if (timeout !== undefined) {
      timer = setTimeout(() => {
        expired = true
        failure ??= new Error('Child command exceeded the fixture deadline')
        stopGroup()
      }, timeout)
    }
  })
}
