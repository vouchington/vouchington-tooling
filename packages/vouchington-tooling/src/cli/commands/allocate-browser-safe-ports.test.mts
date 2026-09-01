import { execFile as execFileCallback } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const scriptPath = resolve('packages/vouchington-tooling/scripts/allocate-browser-safe-ports.py')
const pythonScriptPath = JSON.stringify(scriptPath)
const runnerPortPolicyPath = resolve('packages/vouchington-tooling/scripts/runner-port-policy.json')

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
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      `import importlib.util; spec = importlib.util.spec_from_file_location('allocator', ${pythonScriptPath}); allocator = importlib.util.module_from_spec(spec); spec.loader.exec_module(allocator); allocator.socket.socket = type('Socket', (), {'bind': lambda self, address: setattr(self, 'port', address[1]), 'getsockname': lambda self: ('', self.port), 'close': lambda self: None}); print(*allocator.allocate_ports(3, 1000, runner_slot=50))`,
    ])

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
  it('uses a safe fallback candidate after reserved and Fetch-forbidden candidates', async () => {
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      `import importlib.util; spec = importlib.util.spec_from_file_location('allocator', ${pythonScriptPath}); allocator = importlib.util.module_from_spec(spec); spec.loader.exec_module(allocator); ports = iter([2200, 4045, 4046]); allocator.socket.socket = type('Socket', (), {'bind': lambda self, address: setattr(self, 'port', next(ports)), 'getsockname': lambda self: ('', self.port), 'close': lambda self: None}); print(*allocator.allocate_ports(1, 3))`,
    ])

    const [port] = parsePorts(stdout)
    expect(port).toBe(4046)
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
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      `import importlib.util; spec = importlib.util.spec_from_file_location('allocator', ${pythonScriptPath}); allocator = importlib.util.module_from_spec(spec); spec.loader.exec_module(allocator); allocator.socket.socket = type('Socket', (), {'bind': lambda self, address: (_ for _ in ()).throw(OSError()) if address[1] == 2200 else setattr(self, 'port', address[1]), 'getsockname': lambda self: ('', self.port), 'close': lambda self: None}); print(*allocator.allocate_ports(2, 1000, runner_slot=1))`,
    ])

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
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      `import importlib.util; spec = importlib.util.spec_from_file_location('allocator', ${pythonScriptPath}); allocator = importlib.util.module_from_spec(spec); spec.loader.exec_module(allocator); allocator.socket.socket = type('Socket', (), {'bind': lambda self, address: setattr(self, 'port', address[1]), 'getsockname': lambda self: ('', self.port), 'close': lambda self: None}); print(*allocator.allocate_ports(2, 1000, runner_slot=2))`,
    ])

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
    expect(source).not.toContain('ip_local_port_range')
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
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      `import importlib.util; spec = importlib.util.spec_from_file_location('allocator', ${pythonScriptPath}); allocator = importlib.util.module_from_spec(spec); spec.loader.exec_module(allocator); allocator.socket.socket = type('Socket', (), {'bind': lambda self, address: (_ for _ in ()).throw(OSError()), 'close': lambda self: None});\nfor runner_slot, max_attempts in ((1, 7), (None, 7)):\n try:\n  allocator.allocate_ports(1, max_attempts, runner_slot)\n except RuntimeError as error:\n  print(error)`,
    ])

    expect(stdout.trim().split('\n')).toStrictEqual([
      'failed to allocate 1 ports after 16 bind attempts from runner slice 1',
      'failed to allocate 1 ports after 7 bind attempts from ephemeral ports',
    ])
  })

  it('does not throw when /proc/<pid>/environ is unreadable', async () => {
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      [
        'import importlib.util, os',
        `spec = importlib.util.spec_from_file_location('allocator', ${pythonScriptPath})`,
        'allocator = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(allocator)',
        'allocator.Path.is_file = lambda self: True',
        'original = allocator.Path.read_bytes',
        'def boom(self):',
        "  if self.name in ('environ', 'cmdline'):",
        "    raise PermissionError(13, 'Permission denied', str(self))",
        '  return original(self)',
        'allocator.Path.read_bytes = boom',
        'pid = os.getpid()',
        'print(type(allocator.process_environ(pid)).__name__)',
        'try:',
        '  allocator.process_command_line(pid)',
        "  print('ok')",
        'except Exception as error:',
        '  print(type(error).__name__)',
      ].join('\n'),
    ])
    expect(stdout.trim().split('\n')).toEqual(['dict', 'ok'])
  })

  it('waits for a released port to become bindable before --release returns', async () => {
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      [
        'import importlib.util',
        `spec = importlib.util.spec_from_file_location('allocator', ${pythonScriptPath})`,
        'allocator = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(allocator)',
        'calls = []',
        'class Probe:',
        '  def __init__(self, *args, **kwargs): pass',
        '  def setsockopt(self, *args): pass',
        '  def bind(self, address):',
        '    calls.append(address)',
        '    if len(calls) < 3:',
        '      raise OSError()',
        '  def close(self): pass',
        'allocator.socket.socket = Probe',
        'allocator.HOLD_POLL_SECONDS = 0',
        'allocator.wait_until_port_bindable(12345)',
        'print(len(calls))',
      ].join('\n'),
    ])
    expect(stdout.trim()).toBe('3')
  })
})
