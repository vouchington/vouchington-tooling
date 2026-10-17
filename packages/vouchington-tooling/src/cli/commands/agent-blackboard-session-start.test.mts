import { Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execFile = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile }))
vi.mock('../../agent-blackboard/index.mts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agent-blackboard/index.mts')>()),
  probeBlackboard: vi.fn(),
}))

import { probeBlackboard } from '../../agent-blackboard/index.mts'
import { runAgentBlackboardCommand } from './agent-blackboard.mts'
import { runSessionStart } from './agent-blackboard-session-start.mts'

function stdin(text: string | undefined, isTTY = false): void {
  const stream = Readable.from(text === undefined ? [] : [Buffer.from(text)]) as Readable & {
    isTTY?: boolean
  }
  stream.isTTY = isTTY
  Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
}

function insideRepo(inside: boolean): void {
  execFile.mockImplementation((_cmd, _args, callback) =>
    inside ? callback(null, '', '') : callback(new Error('not a repository')),
  )
}

describe('agent-blackboard session-start', () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin')!
  beforeEach(() => {
    vi.stubEnv('SANDBOX_RUNTIME', '')
  })
  afterEach(() => {
    stdout.mockClear()
    Object.defineProperty(process, 'stdin', originalStdin)
    vi.mocked(probeBlackboard).mockReset()
    vi.unstubAllEnvs()
  })

  it('prints nothing outside a work tree', async () => {
    insideRepo(false)
    stdin('{"session_id":"abc"}')
    expect(await runSessionStart([])).toBe(0)
    expect(stdout).not.toHaveBeenCalled()
  })

  it('emits the session id and a flagged advisory', async () => {
    insideRepo(true)
    stdin('{"session_id":"abc"}')
    vi.mocked(probeBlackboard).mockRejectedValue(new Error('down'))
    expect(await runSessionStart(['--docs-path', 'docs/bb.md', '--setup-hint', 'x'])).toBe(0)
    const output = JSON.parse(String(stdout.mock.calls[0]?.[0]))
    expect(output.hookSpecificOutput.additionalContext).toContain('Blackboard sessionId: abc')
    expect(output.hookSpecificOutput.additionalContext).toContain('(see docs/bb.md)')
  })

  it('honors --skip-env and stays silent for an empty payload', async () => {
    insideRepo(true)
    stdin('')
    vi.stubEnv('MY_SKIP', '1')
    expect(await runSessionStart(['--skip-env', 'MY_SKIP'])).toBe(0)
    expect(probeBlackboard).not.toHaveBeenCalled()
    expect(stdout).not.toHaveBeenCalled()
  })

  it.each([['not json'], ['[1]'], ['null']])('ignores a malformed payload: %s', async (text) => {
    insideRepo(true)
    stdin(text)
    vi.mocked(probeBlackboard).mockResolvedValue(undefined)
    expect(await runSessionStart([])).toBe(0)
    expect(stdout).not.toHaveBeenCalled()
  })

  it('ignores a terminal stdin', async () => {
    insideRepo(true)
    stdin(undefined, true)
    vi.mocked(probeBlackboard).mockResolvedValue(undefined)
    expect(await runSessionStart([])).toBe(0)
    expect(stdout).not.toHaveBeenCalled()
  })

  it('rejects unknown flags', async () => {
    await expect(runSessionStart(['--nope', 'x'])).rejects.toThrow('unknown option: --nope')
  })

  it('is reachable as an agent-blackboard subcommand', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(await runAgentBlackboardCommand(['session-start', '--nope', 'x'])).toBe(2)
    expect(String(stderr.mock.calls[0]?.[0])).toContain('unknown option: --nope')
    stderr.mockRestore()
  })
})
