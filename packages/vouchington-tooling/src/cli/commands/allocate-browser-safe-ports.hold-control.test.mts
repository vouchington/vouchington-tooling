import { execFile as execFileCallback } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  synthesizedPortRangeEnd,
  synthesizedPortRangeStart,
  synthesizedRunnerSlot,
  requiredPort,
  synthesizedSlotHostLockTestTimeoutMs,
  withSynthesizedSlotHostLock,
} from './allocate-browser-safe-ports.slot-fixtures.test-helpers.mts'

const execFile = promisify(execFileCallback)
const scriptPath = resolve('packages/vouchington-tooling/scripts/allocate-browser-safe-ports.py')

function parsePorts(stdout: string): number[] {
  return stdout
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((port) => Number.parseInt(port, 10))
}

function firstNonLoopbackIPv4(): string | undefined {
  return Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address
}

function listenAvailable(port: number, host?: string): Promise<boolean> {
  return new Promise((resolveListen) => {
    const listener = createServer()
    listener.once('error', () => resolveListen(false))
    listener.listen({ port, host }, () => {
      listener.close(() => resolveListen(true))
    })
  })
}

describe('allocate-browser-safe-ports.py hold-dir control', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    const pending = cleanups.splice(0)
    for (const cleanup of pending) await cleanup()
  })

  it('releases and stops when hold-dir is the current directory', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'port-hold-dot-'))
    const workspace = await mkdtemp(join(tmpdir(), 'port-hold-ws-'))
    cleanups.push(async () => {
      await execFile(
        'python3',
        [scriptPath, '--stop', '--hold-dir', '.', '--workspace', workspace],
        { cwd },
      )
      await rm(cwd, { force: true, recursive: true })
      await rm(workspace, { force: true, recursive: true })
    })
    const { stdout } = await execFile(
      'python3',
      [scriptPath, '1', '--hold', '--hold-dir', '.', '--workspace', workspace],
      { cwd },
    )
    const port = requiredPort(parsePorts(stdout)[0])
    await execFile(
      'python3',
      [scriptPath, '--check', '--hold-dir', '.', '--workspace', workspace],
      { cwd },
    )
    await expect(listenAvailable(port, '127.0.0.1')).resolves.toBe(false)
    await execFile(
      'python3',
      [scriptPath, '--release', String(port), '--hold-dir', '.', '--workspace', workspace],
      { cwd },
    )
    await expect(listenAvailable(port, '127.0.0.1')).resolves.toBe(true)
    await execFile('python3', [scriptPath, '--stop', '--hold-dir', '.', '--workspace', workspace], {
      cwd,
    })
    await expect(
      execFile('python3', [scriptPath, '--check', '--hold-dir', '.', '--workspace', workspace], {
        cwd,
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('port holder'),
    })
  })

  it('does not stop a replacement holder that uses a different hold directory', async () => {
    const firstHoldDir = await mkdtemp(join(tmpdir(), 'port-hold-a-'))
    const secondHoldDir = await mkdtemp(join(tmpdir(), 'port-hold-b-'))
    const workspace = await mkdtemp(join(tmpdir(), 'port-hold-ws-'))
    cleanups.push(async () => {
      await execFile('python3', [
        scriptPath,
        '--stop',
        '--hold-dir',
        firstHoldDir,
        '--workspace',
        workspace,
      ])
      await execFile('python3', [
        scriptPath,
        '--stop',
        '--hold-dir',
        secondHoldDir,
        '--workspace',
        workspace,
      ])
      await rm(firstHoldDir, { force: true, recursive: true })
      await rm(secondHoldDir, { force: true, recursive: true })
      await rm(workspace, { force: true, recursive: true })
    })
    await execFile('python3', [
      scriptPath,
      '1',
      '--hold',
      '--hold-dir',
      firstHoldDir,
      '--workspace',
      workspace,
    ])
    const { stdout } = await execFile('python3', [
      scriptPath,
      '1',
      '--hold',
      '--hold-dir',
      secondHoldDir,
      '--workspace',
      workspace,
    ])
    const replacement = requiredPort(parsePorts(stdout)[0])
    const firstPid = Number.parseInt(readFileSync(join(firstHoldDir, 'pid'), 'utf8'), 10)
    const secondPid = Number.parseInt(readFileSync(join(secondHoldDir, 'pid'), 'utf8'), 10)
    expect(firstPid).not.toBe(secondPid)
    await execFile('python3', [
      scriptPath,
      '--stop',
      '--hold-dir',
      firstHoldDir,
      '--workspace',
      workspace,
    ])
    await execFile('python3', [
      scriptPath,
      '--check',
      '--hold-dir',
      secondHoldDir,
      '--workspace',
      workspace,
    ])
    await expect(listenAvailable(replacement, '127.0.0.1')).resolves.toBe(false)
  })

  it('treats --stop as success after the holder is already gone', async () => {
    const holdDir = await mkdtemp(join(tmpdir(), 'port-hold-gone-'))
    const workspace = await mkdtemp(join(tmpdir(), 'port-hold-ws-'))
    cleanups.push(async () => {
      await execFile('python3', [
        scriptPath,
        '--stop',
        '--hold-dir',
        holdDir,
        '--workspace',
        workspace,
      ])
      await rm(holdDir, { force: true, recursive: true })
      await rm(workspace, { force: true, recursive: true })
    })
    await execFile('python3', [
      scriptPath,
      '1',
      '--hold',
      '--hold-dir',
      holdDir,
      '--workspace',
      workspace,
    ])
    const pid = Number.parseInt(readFileSync(join(holdDir, 'pid'), 'utf8'), 10)
    await execFile('kill', ['-TERM', String(pid)])
    await execFile('python3', [
      scriptPath,
      '--stop',
      '--hold-dir',
      holdDir,
      '--workspace',
      workspace,
    ])
  })

  // Darwin cannot reserve 0.0.0.0 after 127.0.0.1 with SO_REUSEADDR=0.
  it.skipIf(process.platform !== 'linux' || !firstNonLoopbackIPv4())(
    'rejects a runner-slice candidate when the IPv4 wildcard is taken',
    async () => {
      const occupiedHost = firstNonLoopbackIPv4() as string
      const root = await mkdtemp(join(tmpdir(), 'runner-slot-'))
      // Spoofs the maximum runner slot, not a real one (see synthesizedRunnerSlot) — occupying
      // its real port range would steal a live runner's ports on a shared host.
      const workspace = join(
        root,
        'actions-runner',
        String(synthesizedRunnerSlot),
        '_work',
        'repo',
        'repo',
      )
      const holdDir = await mkdtemp(join(tmpdir(), 'port-hold-'))
      await mkdir(workspace, { recursive: true })
      const occupied: Array<() => Promise<void>> = []
      cleanups.push(async () => {
        await execFile('python3', [
          scriptPath,
          '--stop',
          '--hold-dir',
          holdDir,
          '--workspace',
          workspace,
        ])
        for (const close of occupied) await close()
        await rm(holdDir, { force: true, recursive: true })
        await rm(root, { force: true, recursive: true })
      })
      // The synthetic slot is shared across every concurrent copy of this test on one host, so
      // hold the host-wide lock around the actual host-global bind, not just the assertion.
      await withSynthesizedSlotHostLock(async () => {
        for (let port = synthesizedPortRangeStart; port <= synthesizedPortRangeEnd; port++) {
          const listener = createServer()
          await new Promise<void>((resolveListen, reject) => {
            listener.once('error', reject)
            listener.listen({ port, host: occupiedHost }, () => {
              resolveListen()
            })
          })
          occupied.push(
            () =>
              new Promise((resolveClose) => {
                listener.close(() => {
                  resolveClose()
                })
              }),
          )
        }
        await expect(
          execFile('python3', [scriptPath, '1', '--hold', '--hold-dir', holdDir], {
            cwd: workspace,
            env: {
              ...process.env,
              GITHUB_ACTIONS: 'true',
              GITHUB_WORKSPACE: workspace,
              VOUCHA_PORT_HOLD_WORKSPACE: workspace,
            },
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining('failed to allocate 1 ports'),
        })
      })
    },
    synthesizedSlotHostLockTestTimeoutMs,
  )
})
