import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

const STDERR_TAIL_BYTES = 16 * 1024

/** A command that emits a unified diff on stdout, such as `git diff` or `gh pr diff`. */
export interface DiffCommand {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd?: string
}

export type DiffBlockCallback = (block: string) => void | Promise<void>

export class DiffCommandError extends Error {
  constructor(
    readonly command: DiffCommand,
    readonly details: { code?: number | null; signal?: NodeJS.Signals | null; stderr: string },
    options?: ErrorOptions,
  ) {
    const status = details.code === null ? details.signal : details.code
    super(
      `${command.executable} ${status === undefined ? 'failed to start' : `exited with ${status}`}${details.stderr ? `: ${details.stderr}` : ''}`,
      options,
    )
    this.name = 'DiffCommandError'
  }
}

function appendTail(
  tail: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike>,
): Buffer<ArrayBufferLike> {
  const combined = Buffer.concat([tail, chunk])
  return combined.length <= STDERR_TAIL_BYTES ? combined : combined.subarray(-STDERR_TAIL_BYTES)
}

function diagnostic(tail: Buffer<ArrayBufferLike>): string {
  return tail.toString('utf8').trim()
}

/**
 * Spawns a command without a shell and emits its unified-diff output one file patch at a time.
 * A preamble is retained with the first patch (or emitted alone); callbacks are provisional until
 * this promise resolves, because a later command failure rejects after prior patches were emitted.
 */
export async function processDiffCommand(
  command: DiffCommand,
  onBlock: DiffBlockCallback,
): Promise<void> {
  const child = spawn(command.executable, [...command.args], {
    cwd: command.cwd,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let streamError: Error | undefined
  const terminate = (): void => {
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL')
  }
  child.stderr.on('data', (chunk: Buffer<ArrayBufferLike>) => {
    stderr = appendTail(stderr, chunk)
  })
  child.stderr.on('error', (error: Error) => {
    streamError ??= error
    terminate()
  })
  const completion = new Promise<{
    code: number | null
    error?: Error
    signal: NodeJS.Signals | null
  }>((resolve) => {
    child.once('error', (error) => resolve({ code: null, error, signal: null }))
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  const decoder = new StringDecoder('utf8')
  let block = ''
  let pending = ''
  let sawFileHeader = false
  let callbackError: unknown
  const acceptLine = async (line: string): Promise<void> => {
    if (line.startsWith('diff --git ') && sawFileHeader) {
      try {
        await onBlock(block)
      } catch (error) {
        callbackError = error
        throw error
      }
      block = ''
    }
    if (line.startsWith('diff --git ')) sawFileHeader = true
    block += line
  }
  const acceptText = async (text: string): Promise<void> => {
    pending += text
    for (let newline = pending.indexOf('\n'); newline >= 0; newline = pending.indexOf('\n')) {
      const line = pending.slice(0, newline + 1)
      pending = pending.slice(newline + 1)
      await acceptLine(line)
    }
  }
  try {
    for await (const chunk of child.stdout) await acceptText(decoder.write(chunk))
    await acceptText(decoder.end())
    if (pending) await acceptLine(pending)
    if (streamError) throw streamError
    if (block) {
      try {
        await onBlock(block)
      } catch (error) {
        callbackError = error
        throw error
      }
    }
    const result = await completion
    if (streamError) throw streamError
    if (result.error)
      throw new DiffCommandError(command, { stderr: diagnostic(stderr) }, { cause: result.error })
    if (result.code !== 0 || result.signal !== null)
      throw new DiffCommandError(command, {
        code: result.code,
        signal: result.signal,
        stderr: diagnostic(stderr),
      })
  } catch (error) {
    terminate()
    await completion
    if (error === callbackError || error instanceof DiffCommandError) throw error
    throw new DiffCommandError(
      command,
      { stderr: diagnostic(stderr) },
      { cause: streamError ?? error },
    )
  }
}
