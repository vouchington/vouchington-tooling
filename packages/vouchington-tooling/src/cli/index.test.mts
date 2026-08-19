import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isMainModule, runCli } from './index.mts'
import { printUsage, USAGE } from './usage.mts'
import { hostLockScriptPath } from './commands/with-host-lock.mts'

describe('runCli', () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => {
    stdout.mockClear()
    stderr.mockClear()
  })

  it('prints help and version', () => {
    expect(runCli(['node', 'vouchington', '--help'])).toBe(0)
    expect(stdout.mock.calls.at(-1)?.[0]).toBe(USAGE)
    expect(runCli(['node', 'vouchington', '--version'])).toBe(0)
    expect(String(stdout.mock.calls.at(-1)?.[0])).toMatch(/^\d+\.\d+\.\d+\n$/)
  })

  it('prints usage on an unknown command', () => {
    expect(runCli(['node', 'vouchington', 'nope'])).toBe(2)
    expect(String(stderr.mock.calls[0]?.[0])).toContain('unknown command: nope')
    expect(String(stderr.mock.calls[1]?.[0])).toBe(USAGE)
  })

  it('prints the shipped runner port policy', () => {
    expect(runCli(['node', 'vouchington', 'runner-port-policy'])).toBe(0)
    expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toMatchObject({
      reservedPortStart: 2200,
      reservedPortEnd: 2999,
    })
  })

  it('reports whether a port is reserved', () => {
    expect(runCli(['node', 'vouchington', 'runner-port-policy', '--reserved', '2200'])).toBe(0)
    expect(stdout.mock.calls.at(-1)?.[0]).toBe('true\n')
    expect(runCli(['node', 'vouchington', 'runner-port-policy', '--reserved', '80'])).toBe(0)
    expect(stdout.mock.calls.at(-1)?.[0]).toBe('false\n')
  })

  it('validates a policy file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vouchington-cli-'))
    const file = join(directory, 'policy.json')
    await writeFile(
      file,
      JSON.stringify({
        reservedPortStart: 1000,
        reservedPortEnd: 1015,
        portsPerRunner: 16,
        minimumRunnerSlot: 1,
        maximumRunnerSlot: 1,
      }),
    )
    expect(runCli(['node', 'vouchington', 'runner-port-policy', '--file', file])).toBe(0)
    expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toMatchObject({
      reservedPortStart: 1000,
    })
  })

  it('runs with-host-lock through the shipped script', () => {
    expect(hostLockScriptPath()).toMatch(/with-host-lock\.sh$/)
    expect(
      runCli([
        'node',
        'vouchington',
        'with-host-lock',
        '--name',
        `cli-test-${process.pid}`,
        '--timeout-seconds',
        '2',
        '--',
        'true',
      ]),
    ).toBe(0)
  })

  it('maps a missing process status to exit 1 and surfaces spawn errors', async () => {
    const { runWithHostLock } = await import('./commands/with-host-lock.mts')
    expect(
      runWithHostLock(['--name', 'x', '--timeout-seconds', '1', '--', 'true'], () => ({
        status: null,
      })),
    ).toBe(1)
    expect(() =>
      runWithHostLock(['--name', 'x'], () => ({
        error: Object.assign(new Error('spawn failed'), { name: 'Error' }),
        status: null,
      })),
    ).toThrow('spawn failed')
  })

  it('identifies the main module from argv', () => {
    const relative = 'packages/vouchington-tooling/src/cli/index.mts'
    expect(isMainModule('file:///tmp/cli.mjs', undefined)).toBe(false)
    expect(isMainModule('file:///tmp/cli.mjs', '/tmp/cli.mjs')).toBe(true)
    expect(isMainModule(pathToFileURL(resolve(relative)).href, relative)).toBe(true)
    const missing = 'does-not-exist.mjs'
    expect(isMainModule(pathToFileURL(resolve(missing)).href, missing)).toBe(true)
  })

  it('writes usage to an explicit stream', () => {
    const chunks: string[] = []
    printUsage({ write: (chunk: string) => chunks.push(chunk) } as unknown as NodeJS.WritableStream)
    expect(chunks.join('')).toBe(USAGE)
  })
})
