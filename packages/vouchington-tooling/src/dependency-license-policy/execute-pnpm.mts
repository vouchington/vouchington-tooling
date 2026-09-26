import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'

import type { PnpmCommandResult, PnpmExecutor } from './types.mts'

const MAX_BUFFER_BYTES = 1024 * 1024

export function signalFromAbort(signal: AbortSignal): NodeJS.Signals {
  if (signal.reason === 'SIGINT' || signal.reason === 'SIGTERM' || signal.reason === 'SIGHUP') {
    return signal.reason
  }
  return 'SIGTERM'
}

export function stopChildProcess(
  child: { kill: (signal?: NodeJS.Signals) => boolean; pid?: number | undefined },
  signal: NodeJS.Signals,
): void {
  if (child.pid === undefined) {
    child.kill(signal)
    return
  }
  try {
    process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

export function collectChildStream(
  stream: Readable | null,
  chunks: string[],
  onOverflow: () => void,
): void {
  if (stream === null) throw new Error('license audit child is missing a stdio pipe')
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    chunks.push(chunk)
    if (Buffer.byteLength(chunks.join('')) > MAX_BUFFER_BYTES) onOverflow()
  })
}

function finishOnce(
  settle: (result: PnpmCommandResult) => void,
): (result: PnpmCommandResult) => void {
  let settled = false
  return (result) => {
    if (settled) return
    settled = true
    settle(result)
  }
}

/** Runs pnpm in its own process group so a signal can reach it and its children. */
export const executePnpm: PnpmExecutor = (command, args, options) =>
  new Promise((resolve) => {
    const child: ChildProcess = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: string[] = []
    const stderr: string[] = []
    let overflow = false
    const stop = () => {
      stopChildProcess(child, overflow ? 'SIGKILL' : signalFromAbort(options.signal))
    }
    if (options.signal.aborted) stop()
    else options.signal.addEventListener('abort', stop, { once: true })
    const markOverflow = () => {
      overflow = true
      stop()
    }
    collectChildStream(child.stdout, stdout, markOverflow)
    collectChildStream(child.stderr, stderr, markOverflow)
    const finish = finishOnce((result) => {
      options.signal.removeEventListener('abort', stop)
      resolve(result)
    })
    child.once('error', (error) => {
      finish({ error, status: null, stderr: stderr.join(''), stdout: stdout.join('') })
    })
    child.once('close', (status) => {
      const result = { status, stderr: stderr.join(''), stdout: stdout.join('') }
      if (!overflow) {
        finish(result)
        return
      }
      finish({
        ...result,
        error: Object.assign(new Error('child output maxBuffer exceeded'), {
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        }),
      })
    })
  })
