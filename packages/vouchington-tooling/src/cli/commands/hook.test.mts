import { Readable } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runHookCommand } from './hook.mts'

const run = vi.hoisted(() => vi.fn())
vi.mock('../../command-policy/hook/run.mts', () => ({ runHook: run }))

afterEach(() => {
  vi.restoreAllMocks()
  run.mockReset()
})

function stubStdin(stdin: Readable & { isTTY?: boolean }): void {
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as unknown as typeof process.stdin)
}

describe('runHookCommand', () => {
  it('forwards its arguments with the process streams and env', async () => {
    run.mockResolvedValue(2)
    const code = await runHookCommand(['pre-tool-use', '--harness', 'claude'])
    expect(code).toBe(2)
    const [args, io] = run.mock.calls[0]!
    expect(args).toEqual(['pre-tool-use', '--harness', 'claude'])
    expect(io).toMatchObject({ env: process.env, cwd: process.cwd(), stdout: process.stdout })
    expect(io.stderr).toBe(process.stderr)
  })

  it('reads all of stdin', async () => {
    run.mockResolvedValue(0)
    stubStdin(Readable.from([Buffer.from('{"a"'), Buffer.from(':1}')]))
    await runHookCommand([])
    expect(await run.mock.calls[0]![1].readStdin()).toBe('{"a":1}')
  })

  it('treats an interactive terminal as empty input', async () => {
    run.mockResolvedValue(0)
    stubStdin(Object.assign(Readable.from([]), { isTTY: true }))
    await runHookCommand([])
    expect(await run.mock.calls[0]![1].readStdin()).toBe('')
  })
})
