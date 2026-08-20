import { execFile as execFileCallback } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const scriptPath = resolve('packages/vouchington-tooling/scripts/allocate-browser-safe-ports.py')

describe('allocate-browser-safe-ports.py --stop wait', () => {
  it('does not wait for bindable ports when --stop finds no live holder', async () => {
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      [
        'import importlib.util, tempfile',
        'from pathlib import Path',
        `spec = importlib.util.spec_from_file_location('allocator', '${scriptPath}')`,
        'allocator = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(allocator)',
        'hold_dir = Path(tempfile.mkdtemp(prefix="port-stop-"))',
        'workspace = tempfile.mkdtemp(prefix="port-stop-ws-")',
        '(hold_dir / "ports").write_text("12345")',
        'def fail_wait(port):',
        '  raise RuntimeError(f"should not wait for {port}")',
        'allocator.wait_until_port_bindable = fail_wait',
        'allocator.wait_until_port_bindable_or_sibling = fail_wait',
        'allocator.request_stop(hold_dir, workspace)',
        'print("ok")',
      ].join('\n'),
    ])
    expect(stdout.trim()).toBe('ok')
  })

  it('leaves a sibling allocator owner in place during live --stop wait', async () => {
    const { stdout, stderr } = await execFile('python3', [
      '-B',
      '-c',
      [
        'import importlib.util, os, tempfile',
        'from pathlib import Path',
        `spec = importlib.util.spec_from_file_location('allocator', '${scriptPath}')`,
        'allocator = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(allocator)',
        'hold_dir = Path(tempfile.mkdtemp(prefix="port-stop-sib-"))',
        'workspace = tempfile.mkdtemp(prefix="port-stop-sib-ws-")',
        '(hold_dir / "ports").write_text("12345")',
        '(hold_dir / "pid").write_text(str(os.getpid()))',
        'alive = True',
        'def pid_is_alive(_pid):',
        '  return alive',
        'def fake_kill(_pid, _sig):',
        '  global alive',
        '  alive = False',
        'allocator.pid_is_alive = pid_is_alive',
        'allocator.is_our_holder = lambda pid, workspace: True',
        'allocator.os.kill = fake_kill',
        'allocator.workspace_holder_pid = lambda workspace: None',
        'allocator.port_is_bindable = lambda port: False',
        'allocator.HOLD_POLL_SECONDS = 0',
        'allocator.CONTROL_WAIT_SECONDS = 2',
        'allocator.sibling_allocator_owner = lambda port, excluded: (',
        '  999, "python3 allocate-browser-safe-ports.py --hold"',
        ')',
        'def fail_plain_wait(port):',
        '  raise RuntimeError(f"release wait leaked into --stop for {port}")',
        'allocator.wait_until_port_bindable = fail_plain_wait',
        'allocator.request_stop(hold_dir, workspace)',
        'print("ok")',
      ].join('\n'),
    ])
    expect(stdout.trim()).toBe('ok')
    expect(stderr).toContain('port 12345 still held by pid 999')
    expect(stderr).toContain('allocate-browser-safe-ports.py')
    expect(stderr).toContain('leaving owner in place')
  })

  it('attributes a live --stop bindable timeout with owner evidence', async () => {
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      [
        'import importlib.util, os, tempfile',
        'from pathlib import Path',
        `spec = importlib.util.spec_from_file_location('allocator', '${scriptPath}')`,
        'allocator = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(allocator)',
        'hold_dir = Path(tempfile.mkdtemp(prefix="port-stop-to-"))',
        'workspace = tempfile.mkdtemp(prefix="port-stop-to-ws-")',
        '(hold_dir / "ports").write_text("12345")',
        '(hold_dir / "pid").write_text(str(os.getpid()))',
        'allocator.pid_is_alive = lambda pid: True',
        'allocator.is_our_holder = lambda pid, workspace: True',
        'allocator.os.kill = lambda pid, sig: None',
        'allocator.workspace_holder_pid = lambda workspace: None',
        'allocator.port_is_bindable = lambda port: False',
        'allocator.sibling_allocator_owner = lambda port, excluded: None',
        'allocator.describe_port_owner = lambda port: "TIME_WAIT ss TIME-WAIT :12345"',
        'allocator.HOLD_POLL_SECONDS = 0',
        'allocator.CONTROL_WAIT_SECONDS = 0',
        'try:',
        '  allocator.request_stop(hold_dir, workspace)',
        'except RuntimeError as error:',
        '  print(error)',
      ].join('\n'),
    ])
    expect(stdout).toContain('port 12345 did not become bindable after 0')
    expect(stdout).toContain('TIME_WAIT')
    expect(stdout.trim()).not.toBe('port 12345 did not become bindable')
  })

  it('classifies lsof pids as sibling allocator owners', async () => {
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      [
        'import importlib.util',
        `spec = importlib.util.spec_from_file_location('allocator', '${scriptPath}')`,
        'allocator = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(allocator)',
        'allocator.run_owner_probe = lambda command: "4321\\n4321\\n" if "-t" in command else ""',
        'allocator.process_command_line = lambda pid: (',
        '  "python3 allocate-browser-safe-ports.py --hold" if pid == 4321 else None',
        ')',
        'print(allocator.sibling_allocator_owner(2200, 99))',
        'print(allocator.compact_probe_text("  a \\n\\n b  "))',
        'print(allocator.describe_port_owner(2200))',
        'allocator.run_owner_probe = lambda command: (',
        '  "users:((python3,pid=88,fd=3))" if command[0] == "ss" else ""',
        ')',
        'allocator.process_command_line = lambda pid: (',
        '  "allocate-browser-safe-ports.py" if pid == 88 else None',
        ')',
        'print(allocator.sibling_allocator_owner(2200, None))',
      ].join('\n'),
    ])
    expect(stdout.trim().split('\n')).toEqual([
      "(4321, 'python3 allocate-browser-safe-ports.py --hold')",
      'a | b',
      'pid 4321 python3 allocate-browser-safe-ports.py --hold',
      "(88, 'allocate-browser-safe-ports.py')",
    ])
  })

  it('describes TIME_WAIT occupancy when no pid owns the port', async () => {
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      [
        'import importlib.util',
        `spec = importlib.util.spec_from_file_location('allocator', '${scriptPath}')`,
        'allocator = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(allocator)',
        'def probe(command):',
        '  if command[0] == "ss":',
        '    return "State TIME-WAIT 127.0.0.1:2200"',
        '  return ""',
        'allocator.run_owner_probe = probe',
        'print(allocator.describe_port_owner(2200))',
        'print(allocator.sibling_allocator_owner(2200, None))',
      ].join('\n'),
    ])
    expect(stdout.trim().split('\n')).toEqual(['TIME_WAIT State TIME-WAIT 127.0.0.1:2200', 'None'])
  })

  it('does not treat a sibling allocator as success for --release', async () => {
    const { stdout } = await execFile('python3', [
      '-B',
      '-c',
      [
        'import importlib.util, tempfile',
        'from pathlib import Path',
        `spec = importlib.util.spec_from_file_location('allocator', '${scriptPath}')`,
        'allocator = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(allocator)',
        'hold_dir = Path(tempfile.mkdtemp(prefix="port-rel-"))',
        '(hold_dir / "release").mkdir(parents=True)',
        'allocator.port_is_bindable = lambda port: False',
        'allocator.sibling_allocator_owner = lambda port, excluded: (',
        '  999, "python3 allocate-browser-safe-ports.py --hold"',
        ')',
        'allocator.HOLD_POLL_SECONDS = 0',
        'allocator.CONTROL_WAIT_SECONDS = 0',
        'try:',
        '  allocator.request_release(hold_dir, 12345)',
        'except RuntimeError as error:',
        '  print(error)',
      ].join('\n'),
    ])
    expect(stdout).toContain('port 12345 was not released by the holder under')
    expect(stdout).not.toContain('leaving owner in place')
  })
})
