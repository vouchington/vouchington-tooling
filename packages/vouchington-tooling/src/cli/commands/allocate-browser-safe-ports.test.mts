import { execFile as execFileCallback } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, type TestContext } from 'vitest'

const execFile = promisify(execFileCallback)
const scriptPath = resolve('packages/vouchington-tooling/scripts/allocate-browser-safe-ports.py')
const pythonScriptPath = JSON.stringify(scriptPath)
const runnerPortPolicyPath = resolve('packages/vouchington-tooling/scripts/runner-port-policy.json')

const prelude = `import importlib.util, errno, socket
spec = importlib.util.spec_from_file_location('allocator', ${pythonScriptPath})
allocator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(allocator)
real_read_ephemeral_range = allocator.read_ephemeral_range
allocator.read_ephemeral_range = lambda: (32768, 60999)
allocator.random.shuffle = lambda items: None
def install(bind=lambda family, address: None):
    class Sock:
        def __init__(self, family, kind): self.family = family
        def bind(self, address): bind(self.family, address)
        def close(self): pass
    allocator.socket.socket = Sock
def refuse(code):
    raise OSError(code, 'refused')
`

function runAllocator(body: string) {
  return execFile('python3', ['-B', '-c', `${prelude}${body}`])
}

async function readEphemeralRange(): Promise<[number, number]> {
  const raw =
    process.platform === 'linux'
      ? readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8')
      : (
          await execFile('sysctl', [
            '-n',
            'net.inet.ip.portrange.first',
            'net.inet.ip.portrange.last',
          ])
        ).stdout
  const [first, last] = raw.trim().split(/\s+/).map(Number)
  return [first!, last!]
}

function listenOnce(host: string, port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, host, () => server.close(() => resolvePromise()))
  })
}

function parsePorts(stdout: string): number[] {
  return stdout
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((port) => Number.parseInt(port, 10))
}

async function withTemporaryCwd<T>(callback: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'allocate-browser-safe-ports-'))
  return callback(cwd).finally(() => rm(cwd, { force: true, recursive: true }))
}

describe('allocate-browser-safe-ports.py', () => {
  it('accepts explicit policy and forbidden-port paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'allocate-policy-'))
    const policy = join(directory, 'policy.json')
    const forbidden = join(directory, 'forbidden.json')
    writeFileSync(
      policy,
      JSON.stringify({
        reservedPortStart: 2200,
        reservedPortEnd: 2215,
        portsPerRunner: 16,
        minimumRunnerSlot: 1,
        maximumRunnerSlot: 1,
      }),
    )
    writeFileSync(forbidden, '[1,22]')
    try {
      const { stdout } = await execFile(
        'python3',
        [scriptPath, '1', '--policy', policy, '--forbidden-ports', forbidden],
        { env: { ...process.env, GITHUB_ACTIONS: '' } },
      )
      expect(parsePorts(stdout)).toHaveLength(1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('allocates the requested number of unique ports', async () => {
    const { stdout } = await execFile('python3', [scriptPath, '6'], {
      cwd: process.cwd(),
      env: { ...process.env, GITHUB_ACTIONS: '' },
    })
    const ports = parsePorts(stdout)

    expect(ports).toHaveLength(6)
    expect(new Set(ports).size).toBe(6)
    for (const port of ports) {
      expect(Number.isInteger(port)).toBe(true)
      expect(port).toBeGreaterThan(0)
      expect(port < 2200 || port > 2999).toBe(true)
    }
  })
  it('uses the slot-50 boundary of the deterministic runner slice', async () => {
    const { stdout } = await runAllocator(
      'install()\nprint(*allocator.allocate_ports(3, 1000, runner_slot=50))',
    )

    expect(parsePorts(stdout)).toEqual([2984, 2985, 2986])
  })
  it('recognizes the singular runner directory name from the current directory', async () => {
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      `import importlib.util; spec = importlib.util.spec_from_file_location('allocator', ${pythonScriptPath}); allocator = importlib.util.module_from_spec(spec); spec.loader.exec_module(allocator); print(allocator.detect_runner_slot('', '/srv/actions-runner/8/_work/repo'))`,
    ])

    expect(stdout.trim()).toBe('8')
  })
  it('recognizes the plural runner directory name only with the canonical work path', async () => {
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      `import importlib.util; spec = importlib.util.spec_from_file_location('allocator', ${pythonScriptPath}); allocator = importlib.util.module_from_spec(spec); spec.loader.exec_module(allocator); print(allocator.detect_runner_slot('/srv/actions-runners/9/_work/repo/repo', '/tmp'))`,
    ])

    expect(stdout.trim()).toBe('9')
  })
  it('uses no deterministic slot for a nonnumeric runner path', async () => {
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      `import importlib.util; spec = importlib.util.spec_from_file_location('allocator', ${pythonScriptPath}); allocator = importlib.util.module_from_spec(spec); spec.loader.exec_module(allocator); print(allocator.detect_runner_slot('/srv/actions-runners/blue/_work/repo/repo', ''))`,
    ])

    expect(stdout.trim()).toBe('None')
  })
  it('skips reserved, Fetch-forbidden, and ephemeral-range candidates', async () => {
    const { stdout } = await runAllocator(
      'allocator.read_ephemeral_range = lambda: (4047, 65535)\ninstall()\nprint(*allocator.allocate_ports(2000, 5000))',
    )
    const ports = parsePorts(stdout)
    const forbidden = JSON.parse(
      readFileSync(
        resolve('packages/vouchington-tooling/scripts/fetch-forbidden-ports.json'),
        'utf8',
      ),
    ) as number[]

    expect(new Set(ports).size).toBe(2000)
    expect(ports.filter((port) => port >= 2200 && port <= 2999)).toEqual([])
    expect(ports.filter((port) => forbidden.includes(port))).toEqual([])
    expect(Math.max(...ports)).toBeLessThan(4047)
  })
  it('rejects leading-zero runner slots', async () => {
    await expect(
      execFile('python3', [
        '-B',
        '-c',
        `import importlib.util; spec = importlib.util.spec_from_file_location('allocator', ${pythonScriptPath}); allocator = importlib.util.module_from_spec(spec); spec.loader.exec_module(allocator); allocator.detect_runner_slot('/srv/actions-runner/01/_work/repo', '')`,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('runner slot 01 must use canonical decimal spelling'),
    })
  })
  it('skips an occupied first port in a deterministic slice', async () => {
    const { stdout } = await runAllocator(
      'install(lambda family, address: refuse(errno.EADDRINUSE) if address[1] == 2200 else None)\nprint(*allocator.allocate_ports(2, 1000, runner_slot=1))',
    )

    expect(parsePorts(stdout)).toEqual([2201, 2202])
  })
  it('fails closed for an invalid numeric runner slot', async () => {
    await expect(
      withTemporaryCwd((cwd) =>
        execFile('python3', [scriptPath, '1'], {
          cwd,
          env: {
            ...process.env,
            GITHUB_ACTIONS: 'true',
            GITHUB_WORKSPACE: '/opt/actions-runner/51/_work/repo/repo',
          },
        }),
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('runner slot 51 is outside the supported range 1-50'),
    })
  })

  it('fails before allocation when a runner-slice request exceeds capacity', async () => {
    await expect(
      withTemporaryCwd((cwd) =>
        execFile('python3', [scriptPath, '17'], {
          cwd,
          env: {
            ...process.env,
            GITHUB_ACTIONS: 'true',
            GITHUB_WORKSPACE: '/opt/actions-runner/1/_work/repo/repo',
          },
        }),
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('requested 17 ports exceeds runner slice capacity 16'),
    })
  })

  it('allocates a deterministic slice on Linux without reading host configuration', async () => {
    const { stdout } = await runAllocator(
      'install()\nprint(*allocator.allocate_ports(2, 1000, runner_slot=2))',
    )

    expect(parsePorts(stdout)).toEqual([2216, 2217])
  })
  it('rejects boolean values in the runner port policy', async () => {
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      `import importlib.util, json, pathlib, tempfile; spec = importlib.util.spec_from_file_location('allocator', ${pythonScriptPath}); allocator = importlib.util.module_from_spec(spec); spec.loader.exec_module(allocator);\nwith tempfile.TemporaryDirectory() as directory:\n path = pathlib.Path(directory) / 'policy.json'; path.write_text(json.dumps({'reservedPortStart': True, 'reservedPortEnd': 2999, 'portsPerRunner': 16, 'minimumRunnerSlot': 1, 'maximumRunnerSlot': 50}))\n try:\n  allocator.load_runner_port_policy(path)\n except RuntimeError as error:\n  print(error)`,
    ])

    expect(stdout).toContain('invalid runner port policy')
  })

  it('keeps Fetch-forbidden ports in one shared list', () => {
    const source = readFileSync(scriptPath, 'utf8')
    const policy = JSON.parse(readFileSync(runnerPortPolicyPath, 'utf8'))

    const forbidden = JSON.parse(
      readFileSync(
        resolve('packages/vouchington-tooling/scripts/fetch-forbidden-ports.json'),
        'utf8',
      ),
    )
    expect(source).toContain('from __future__ import annotations')
    expect(source).toContain('--policy')
    expect(source).toContain('--forbidden-ports')
    expect(source).toContain('SCRIPT_DIR / "fetch-forbidden-ports.json"')
    expect(source).toContain('SCRIPT_DIR / "runner-port-policy.json"')
    expect(source).not.toContain('ip_local_reserved_ports')
    expect(source).not.toContain('docker version')
    expect(policy).toEqual({
      reservedPortStart: 2200,
      reservedPortEnd: 2999,
      portsPerRunner: 16,
      minimumRunnerSlot: 1,
      maximumRunnerSlot: 50,
    })
    expect(forbidden).toEqual(expect.arrayContaining([1, 22, 4045, 4190, 6667, 6679, 10_080]))
  })

  it('reports the actual number of exhausted allocation candidates', async () => {
    const { stdout } = await runAllocator(
      `install(lambda family, address: refuse(errno.EADDRINUSE))
for runner_slot, max_attempts in ((1, 7), (None, 7)):
    try:
        allocator.allocate_ports(1, max_attempts, runner_slot)
    except RuntimeError as error:
        print(error)`,
    )

    expect(stdout.trim().split('\n')).toStrictEqual([
      'failed to allocate 1 ports after 16 bind attempts from runner slice 1',
      'failed to allocate 1 ports after 7 bind attempts from non-ephemeral ports',
    ])
  })
  it('skips Fetch-forbidden ports inside a runner slice', async () => {
    const { stdout } = await runAllocator(
      'allocator.CHROMIUM_RESTRICTED_PORTS = frozenset({2200})\ninstall()\nprint(*allocator.allocate_ports(2, 1000, runner_slot=1))',
    )

    expect(parsePorts(stdout)).toEqual([2201, 2202])
  })

  it('skips a port that is only in use on ::1', async () => {
    const { stdout } = await runAllocator(
      'install(lambda family, address: refuse(errno.EADDRINUSE) if family == socket.AF_INET6 and address[1] == 1024 else None)\nprint(*allocator.allocate_ports(2, 1000))',
    )

    expect(parsePorts(stdout)).toEqual([1025, 1026])
  })

  it('degrades to an IPv4-only check with one warning when ::1 is unavailable', async () => {
    const { stdout, stderr } = await runAllocator(
      'install(lambda family, address: refuse(errno.EAFNOSUPPORT) if family == socket.AF_INET6 else None)\nprint(*allocator.allocate_ports(2, 1000))',
    )

    expect(parsePorts(stdout)).toEqual([1024, 1025])
    expect(stderr.match(/IPv6 loopback \(::1\) is unavailable/g)).toHaveLength(1)
  })

  it('reads the ephemeral range from the platform and reports when it is unreadable', async () => {
    const { stdout, stderr } = await runAllocator(
      `allocator.read_ephemeral_range = real_read_ephemeral_range
class FakePath:
    def __init__(self, path): pass
    def read_text(self): return '32768\\t60999\\n'
allocator.Path = FakePath
allocator.sys.platform = 'linux'
print(allocator.read_ephemeral_range())
allocator.subprocess.run = lambda *a, **k: type('R', (), {'stdout': '49152\\n65535\\n'})()
allocator.sys.platform = 'darwin'
print(allocator.read_ephemeral_range())
allocator.subprocess.run = lambda *a, **k: type('R', (), {'stdout': '65535\\n49152\\n'})()
print(allocator.read_ephemeral_range())
allocator.sys.platform = 'win32'
print(allocator.read_ephemeral_range())
allocator.sys.platform = 'linux'
FakePath.read_text = lambda self: 'garbage'
print(allocator.read_ephemeral_range())
print(len(allocator.candidate_pool()) > 60000)`,
    )

    expect(stdout.trim().split('\n')).toEqual([
      '(32768, 60999)',
      '(49152, 65535)',
      '(49152, 65535)',
      'None',
      'None',
      'True',
    ])
    expect(stderr).toContain('could not read the OS ephemeral port range')
  })

  it('returns ports outside the real ephemeral range that are free on 127.0.0.1 and ::1', async (context: TestContext) => {
    const [first, last] = await readEphemeralRange()
    const { stdout } = await execFile('python3', [scriptPath, '8'], {
      env: { ...process.env, GITHUB_ACTIONS: '' },
    })
    const ports = parsePorts(stdout)

    expect(ports).toHaveLength(8)
    for (const port of ports) {
      expect(port < first || port > last).toBe(true)
      await listenOnce('127.0.0.1', port)
      await listenOnce('::1', port).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT') return context.skip()
        throw error
      })
    }
  })

  it('does not advertise hold, release, stop, or check modes', async () => {
    const { stdout } = await execFile('python3', [scriptPath, '--help'])
    expect(stdout).not.toContain('--hold')
    expect(stdout).not.toContain('--release')
    expect(stdout).not.toContain('--stop')
    expect(stdout).not.toContain('--check')
  })
})
