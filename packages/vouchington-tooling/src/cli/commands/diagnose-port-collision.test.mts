import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listenOnRunnerUnreservedEphemeralPort } from '../../runner-port-policy/index.mts'

const execFileAsync = promisify(execFile)
const scriptPath = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gha/diagnose-port-collision.sh',
)
const previousDockerTimeout = process.env.VOUCHINGTON_DOCKER_DIAGNOSTIC_TIMEOUT_SECONDS

beforeAll(() => {
  process.env.VOUCHINGTON_DOCKER_DIAGNOSTIC_TIMEOUT_SECONDS = '1'
})

afterAll(() => {
  if (previousDockerTimeout === undefined)
    delete process.env.VOUCHINGTON_DOCKER_DIAGNOSTIC_TIMEOUT_SECONDS
  else process.env.VOUCHINGTON_DOCKER_DIAGNOSTIC_TIMEOUT_SECONDS = previousDockerTimeout
})

async function listenOnEphemeralPort(): Promise<{
  server: ReturnType<typeof createServer>
  port: number
}> {
  const server = createServer()
  const port = await listenOnRunnerUnreservedEphemeralPort(server, '127.0.0.1')
  return { server, port }
}

async function writeExecutable(directory: string, name: string, source: string): Promise<void> {
  const path = join(directory, name)
  await writeFile(path, source)
  await chmod(path, 0o755)
}

async function linkExecutable(directory: string, name: string): Promise<void> {
  const { stdout } = await execFileAsync('which', [name])
  await symlink(stdout.trim(), join(directory, name))
}

describe('diagnose-port-collision', () => {
  it('reports a forced listener collision without failing', async () => {
    const { server, port } = await listenOnEphemeralPort()
    const outputDir = await mkdtemp(join(tmpdir(), 'port-diagnostics-'))
    try {
      const result = await execFileAsync('bash', [
        scriptPath,
        '--ports',
        String(port),
        '--output-dir',
        outputDir,
      ])
      const listeners = await readFile(join(outputDir, 'listeners.txt'), 'utf8')
      expect(result.stderr).toBe('')
      expect(listeners).toContain(`port=${port}`)
      expect(listeners).toContain('status=occupied')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(outputDir, { recursive: true, force: true })
    }
  })

  it('keeps collection non-masking for malformed and out-of-range ports', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'port-diagnostics-'))
    try {
      const result = await execFileAsync('bash', [
        scriptPath,
        '--ports',
        'not-a-port 0 70000',
        '--output-dir',
        outputDir,
      ])
      const summary = await readFile(join(outputDir, 'summary.txt'), 'utf8')
      expect(result.stderr).toBe('')
      expect(summary).toContain('invalid_ports=not-a-port 0 70000')
    } finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  })

  it('reports a released selected port as free or unobserved', async () => {
    const { server, port } = await listenOnEphemeralPort()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    const outputDir = await mkdtemp(join(tmpdir(), 'port-diagnostics-'))
    try {
      await execFileAsync('bash', [scriptPath, '--ports', String(port), '--output-dir', outputDir])
      const listeners = await readFile(join(outputDir, 'listeners.txt'), 'utf8')
      expect(listeners).toContain(`port=${port}`)
      expect(listeners).toContain('status=free-or-unobserved')
    } finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  })

  it('records unavailable host probes without failing', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'port-diagnostics-'))
    const executableDir = await mkdtemp(join(tmpdir(), 'port-probes-'))
    for (const name of ['bash', 'date', 'hostname', 'id', 'mkdir', 'python3', 'tr', 'uname']) {
      await linkExecutable(executableDir, name)
    }
    try {
      const result = await execFileAsync(
        'bash',
        [scriptPath, '--ports', '2200', '--output-dir', outputDir],
        { env: { ...process.env, PATH: executableDir } },
      )
      expect(result.stderr).toBe('')
      expect(await readFile(join(outputDir, 'listeners.txt'), 'utf8')).toContain(
        'probe=unavailable (neither lsof nor ss is installed)',
      )
      expect(await readFile(join(outputDir, 'docker.txt'), 'utf8')).toContain('docker=unavailable')
      expect(await readFile(join(outputDir, 'kernel.txt'), 'utf8')).toContain('sysctl=unavailable')
    } finally {
      await rm(outputDir, { recursive: true, force: true })
      await rm(executableDir, { recursive: true, force: true })
    }
  })

  it('reports only lsof sockets whose local endpoint uses the selected port', async () => {
    const { server, port } = await listenOnEphemeralPort()
    const outputDir = await mkdtemp(join(tmpdir(), 'port-diagnostics-'))
    const executableDir = await mkdtemp(join(tmpdir(), 'port-probes-'))
    const remoteMatch = `127.0.0.1:41000->127.0.0.1:${port}`
    const localMatch = `127.0.0.1:${port}->127.0.0.1:41001`
    await writeExecutable(
      executableDir,
      'lsof',
      `#!/usr/bin/env bash
echo 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME'
echo 'node 1 user 10u IPv4 0x1 0t0 TCP ${remoteMatch} (ESTABLISHED)'
echo 'node 2 user 11u IPv4 0x2 0t0 TCP ${localMatch} (ESTABLISHED)'
`,
    )
    try {
      await execFileAsync(
        'bash',
        [scriptPath, '--ports', String(port), '--output-dir', outputDir],
        {
          env: { ...process.env, PATH: `${executableDir}:${process.env.PATH}` },
        },
      )
      const listeners = await readFile(join(outputDir, 'listeners.txt'), 'utf8')
      expect(listeners).toContain(localMatch)
      expect(listeners).not.toContain(remoteMatch)
      expect(listeners).toContain('status=occupied')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(outputDir, { recursive: true, force: true })
      await rm(executableDir, { recursive: true, force: true })
    }
  })

  it('falls back to ss when lsof is missing and records docker published ports', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'port-diagnostics-'))
    const executableDir = await mkdtemp(join(tmpdir(), 'port-probes-'))
    for (const name of [
      'bash',
      'date',
      'grep',
      'hostname',
      'id',
      'mkdir',
      'python3',
      'tr',
      'uname',
      'tail',
    ]) {
      await linkExecutable(executableDir, name)
    }
    await writeExecutable(
      executableDir,
      'ss',
      `#!/usr/bin/env bash
echo 'State Recv-Q Send-Q Local Address:Port Peer Address:Port'
echo 'LISTEN 0 0 127.0.0.1:2200 0.0.0.0:*'
`,
    )
    await writeExecutable(
      executableDir,
      'docker',
      `#!/usr/bin/env bash
if [ "$1" = version ]; then echo 'server=test'; exit 0; fi
echo 'container=abc names=web ports=0.0.0.0:2200->80/tcp'
`,
    )
    try {
      await execFileAsync('bash', [scriptPath, '--ports', '2200', '--output-dir', outputDir], {
        env: { ...process.env, PATH: executableDir },
      })
      expect(await readFile(join(outputDir, 'listeners.txt'), 'utf8')).toContain('status=occupied')
      expect(await readFile(join(outputDir, 'docker.txt'), 'utf8')).toContain('published_port=2200')
    } finally {
      await rm(outputDir, { recursive: true, force: true })
      await rm(executableDir, { recursive: true, force: true })
    }
  })

  it('returns non-masking partial evidence when the collector deadline elapses', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'port-diagnostics-'))
    const executableDir = await mkdtemp(join(tmpdir(), 'port-probes-'))
    await writeExecutable(executableDir, 'lsof', '#!/usr/bin/env bash\nsleep 5\n')
    try {
      const result = await execFileAsync(
        'bash',
        [scriptPath, '--ports', '2200', '--output-dir', outputDir],
        {
          env: {
            ...process.env,
            PORT_DIAGNOSTICS_TIMEOUT_SECONDS: '0.5',
            PATH: `${executableDir}:${process.env.PATH}`,
          },
          timeout: 2000,
        },
      )
      expect(result.stderr).toContain('collector exceeded 0.5s')
      expect(await readFile(join(outputDir, 'summary.txt'), 'utf8')).toContain(
        'allocated_ports=2200',
      )
    } finally {
      await rm(outputDir, { recursive: true, force: true })
      await rm(executableDir, { recursive: true, force: true })
    }
  })

  it('prints usage, ignores unknown args, and never fails mkdir errors', async () => {
    const help = await execFileAsync('bash', [scriptPath, '--help'])
    expect(help.stdout).toContain('Usage: diagnose-port-collision')
    const missing = await execFileAsync('bash', [scriptPath, '--ports'])
    expect(missing.stderr).toContain('Usage: diagnose-port-collision')
    const outputDir = await mkdtemp(join(tmpdir(), 'port-diagnostics-'))
    try {
      const unknown = await execFileAsync('bash', [
        scriptPath,
        '--wat',
        '--output-dir',
        outputDir,
        '--ports',
        '2200',
      ])
      expect(unknown.stderr).toContain('Ignoring unknown diagnostics argument: --wat')
    } finally {
      await rm(outputDir, { recursive: true, force: true })
    }
    const blockedParent = await mkdtemp(join(tmpdir(), 'port-diagnostics-file-'))
    const blocked = join(blockedParent, 'not-a-dir')
    await writeFile(blocked, 'file')
    try {
      const result = await execFileAsync('bash', [
        scriptPath,
        '--output-dir',
        join(blocked, 'child'),
      ])
      expect(result.stderr).toContain('Could not create port diagnostics directory')
    } finally {
      await rm(blockedParent, { recursive: true, force: true })
    }
  })

  it('defaults invalid collector timeouts to 45s without failing', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'port-diagnostics-'))
    try {
      const result = await execFileAsync(
        'bash',
        [scriptPath, '--ports', '2200', '--output-dir', outputDir],
        { env: { ...process.env, PORT_DIAGNOSTICS_TIMEOUT_SECONDS: 'nope' } },
      )
      expect(result.stderr).toBe('')
      expect(await readFile(join(outputDir, 'summary.txt'), 'utf8')).toContain(
        'allocated_ports=2200',
      )
    } finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  })
})
