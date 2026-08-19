import { execFile as execFileCallback } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  requiredPort,
  synthesizedPortRangeEnd,
  synthesizedPortRangeStart,
  synthesizedRunnerSlot,
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

function httpConnects(port: number, host: string): Promise<boolean> {
  return new Promise((resolveConnect) => {
    const socket = createConnection({ port, host })
    socket.setTimeout(250)
    socket.once('timeout', () => {
      socket.destroy()
      resolveConnect(false)
    })
    socket.once('connect', () => {
      socket.destroy()
      resolveConnect(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolveConnect(false)
    })
  })
}

async function pidAlive(pid: number): Promise<boolean> {
  try {
    await execFile('kill', ['-0', String(pid)])
    return true
  } catch {
    return false
  }
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

async function stopHolder(holdDir: string, workspace: string): Promise<void> {
  await execFile('python3', [scriptPath, '--stop', '--hold-dir', holdDir, '--workspace', workspace])
}

describe('allocate-browser-safe-ports.py hold mode', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    const pending = cleanups.splice(0)
    for (const cleanup of pending) await cleanup()
  })

  async function startHolder(count: number): Promise<{
    ports: number[]
    holdDir: string
    workspace: string
  }> {
    const holdDir = await mkdtemp(join(tmpdir(), 'port-hold-'))
    const workspace = await mkdtemp(join(tmpdir(), 'port-hold-ws-'))
    cleanups.push(async () => {
      await stopHolder(holdDir, workspace)
      await rm(holdDir, { force: true, recursive: true })
      await rm(workspace, { force: true, recursive: true })
    })
    const { stdout } = await execFile('python3', [
      scriptPath,
      String(count),
      '--hold',
      '--hold-dir',
      holdDir,
      '--workspace',
      workspace,
    ])
    return { ports: parsePorts(stdout), holdDir, workspace }
  }

  it('blocks IPv4, loopback, and IPv6 binds until the port is released', async () => {
    const { ports, holdDir, workspace } = await startHolder(1)
    const port = requiredPort(ports[0])

    await expect(listenAvailable(port, '127.0.0.1')).resolves.toBe(false)
    await execFile('python3', [
      scriptPath,
      '--check',
      '--hold-dir',
      holdDir,
      '--workspace',
      workspace,
    ])
    await expect(httpConnects(port, '127.0.0.1')).resolves.toBe(false)

    await execFile('python3', [
      scriptPath,
      '--release',
      String(port),
      '--hold-dir',
      holdDir,
      '--workspace',
      workspace,
    ])
    await expect(listenAvailable(port, '127.0.0.1')).resolves.toBe(true)
  })

  it.skipIf(process.platform !== 'linux')(
    'blocks wildcard IPv4 and IPv6 binds on Linux',
    async () => {
      const { ports } = await startHolder(1)
      const port = requiredPort(ports[0])
      await expect(listenAvailable(port, '0.0.0.0')).resolves.toBe(false)
      await expect(listenAvailable(port, '::')).resolves.toBe(false)
    },
  )

  it('holds five ports from a numeric runner slice', async () => {
    const liveWorkspace = process.env.GITHUB_WORKSPACE
    const useLiveSlot =
      process.env.GITHUB_ACTIONS === 'true' &&
      Boolean(liveWorkspace) &&
      /(?:actions-runner|actions-runners)\/\d+\/_work/.test(liveWorkspace ?? '')
    const root = useLiveSlot ? undefined : await mkdtemp(join(tmpdir(), 'runner-slot-'))
    // Spoofs the max runner slot (see synthesizedRunnerSlot); no host-wide lock needed here
    // since this test never binds a real host socket, only the daemon's own file-lock holds.
    const workspace = useLiveSlot
      ? (liveWorkspace as string)
      : join(
          root as string,
          'actions-runner',
          String(synthesizedRunnerSlot),
          '_work',
          'repo',
          'repo',
        )
    const holdDir = await mkdtemp(join(tmpdir(), 'port-hold-'))
    if (!useLiveSlot) await mkdir(workspace, { recursive: true })
    cleanups.push(async () => {
      await stopHolder(holdDir, workspace)
      await rm(holdDir, { force: true, recursive: true })
      if (root) await rm(root, { force: true, recursive: true })
    })
    const { stdout } = await execFile(
      'python3',
      [scriptPath, '5', '--hold', '--hold-dir', holdDir],
      {
        cwd: workspace,
        env: {
          ...process.env,
          GITHUB_ACTIONS: 'true',
          GITHUB_WORKSPACE: workspace,
          VOUCHA_PORT_HOLD_WORKSPACE: workspace,
        },
      },
    )
    const ports = parsePorts(stdout)
    expect(ports).toHaveLength(5)
    expect(new Set(ports).size).toBe(5)
    expect(
      ports.every((port) =>
        useLiveSlot
          ? port >= 2200 && port <= 2999
          : port >= synthesizedPortRangeStart && port <= synthesizedPortRangeEnd,
      ),
    ).toBe(true)
    await expect(listenAvailable(requiredPort(ports[0]), '127.0.0.1')).resolves.toBe(false)
  })

  it('refuses an HTTP connect while the port is held without listen()', async () => {
    const { ports } = await startHolder(1)
    const port = requiredPort(ports[0])
    await expect(httpConnects(port, '127.0.0.1')).resolves.toBe(false)
  })

  it('releases one held port and keeps the other reserved', async () => {
    const { ports, holdDir, workspace } = await startHolder(2)
    const first = requiredPort(ports[0])
    const second = requiredPort(ports[1])

    await execFile('python3', [
      scriptPath,
      '--release',
      String(first),
      '--hold-dir',
      holdDir,
      '--workspace',
      workspace,
    ])
    await execFile('python3', [
      scriptPath,
      '--release',
      String(first),
      '--hold-dir',
      holdDir,
      '--workspace',
      workspace,
    ])
    await expect(listenAvailable(first, '127.0.0.1')).resolves.toBe(true)
    await expect(listenAvailable(second, '127.0.0.1')).resolves.toBe(false)
  })

  it('stops the holder and frees every remaining port', async () => {
    const { ports, holdDir, workspace } = await startHolder(2)
    await execFile('python3', [
      scriptPath,
      '--stop',
      '--hold-dir',
      holdDir,
      '--workspace',
      workspace,
    ])
    await expect(
      execFile('python3', [scriptPath, '--check', '--hold-dir', holdDir, '--workspace', workspace]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('port holder'),
    })
    for (const port of ports) {
      await expect(listenAvailable(port, '127.0.0.1')).resolves.toBe(true)
    }
  })

  it('reaps a leftover holder for the same workspace only', async () => {
    const first = await startHolder(1)
    const secondHoldDir = await mkdtemp(join(tmpdir(), 'port-hold-'))
    cleanups.push(async () => {
      await stopHolder(secondHoldDir, first.workspace)
      await rm(secondHoldDir, { force: true, recursive: true })
    })
    const other = await startHolder(1)
    const { stdout } = await execFile('python3', [
      scriptPath,
      '1',
      '--hold',
      '--hold-dir',
      secondHoldDir,
      '--workspace',
      first.workspace,
    ])
    const [replacement] = parsePorts(stdout)
    const firstPid = Number.parseInt(readFileSync(join(first.holdDir, 'pid'), 'utf8'), 10)
    const replacementPid = Number.parseInt(readFileSync(join(secondHoldDir, 'pid'), 'utf8'), 10)
    const otherPid = Number.parseInt(readFileSync(join(other.holdDir, 'pid'), 'utf8'), 10)
    const firstStillAlive = await pidAlive(firstPid)
    expect(firstStillAlive && firstPid !== replacementPid).toBe(false)
    await expect(pidAlive(otherPid)).resolves.toBe(true)
    await expect(listenAvailable(requiredPort(replacement), '127.0.0.1')).resolves.toBe(false)
    await expect(listenAvailable(requiredPort(other.ports[0]), '127.0.0.1')).resolves.toBe(false)
  })

  it('resolves a relative hold directory before daemonizing', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'port-hold-rel-'))
    const workspace = await mkdtemp(join(tmpdir(), 'port-hold-ws-'))
    const holdDir = join(cwd, 'hold')
    cleanups.push(async () => {
      await stopHolder(holdDir, workspace)
      await rm(cwd, { force: true, recursive: true })
      await rm(workspace, { force: true, recursive: true })
    })
    const { stdout } = await execFile(
      'python3',
      [scriptPath, '1', '--hold', '--hold-dir', 'hold', '--workspace', workspace],
      { cwd },
    )
    const port = requiredPort(parsePorts(stdout)[0])
    await expect(listenAvailable(port, '127.0.0.1')).resolves.toBe(false)
    await execFile('python3', [
      scriptPath,
      '--check',
      '--hold-dir',
      holdDir,
      '--workspace',
      workspace,
    ])
  })
})
