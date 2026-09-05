import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyHarnessConfig, checkHarnessConfig, dumpHarnessPolicy } from './index.mts'
import { parseAgentHarnessConfigArguments, runAgentHarnessConfigCli } from './cli.mts'
import { applyTomlPatches, readTomlKey } from './merge-toml.mts'
import { CURSOR_APPROVAL_MODE, DEFAULT_EXTRA_WRITABLE_ROOTS } from './policy.mts'

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

describe('dumpHarnessPolicy', () => {
  it('maps every harness to classifier-auto and sandbox, never YOLO keys', () => {
    const dump = JSON.stringify(dumpHarnessPolicy())
    expect(dumpHarnessPolicy().claude.defaultMode).toBe('auto')
    expect(dumpHarnessPolicy().codex.approvals_reviewer).toBe('auto_review')
    expect(dumpHarnessPolicy().grok.permission_mode).toBe('auto')
    expect(dumpHarnessPolicy().grok.auto_mode_enabled).toBe(true)
    expect(dumpHarnessPolicy().grok.default_auto_mode).toBe(true)
    expect(dumpHarnessPolicy().cursor.approvalMode).toBe(CURSOR_APPROVAL_MODE)
    expect(dumpHarnessPolicy().extraWritableRoots).toEqual([...DEFAULT_EXTRA_WRITABLE_ROOTS])
    expect(dump).not.toMatch(/unrestricted|always-approve|bypassPermissions|"never"/)
  })
})

describe('JSON apply', () => {
  it('replaces Cursor unrestricted with auto-review and enables sandbox', async () => {
    const home = await tempDir('harness-cursor-')
    const path = join(home, '.cursor', 'cli-config.json')
    await mkdir(join(home, '.cursor'), { recursive: true })
    await writeFile(
      path,
      `${JSON.stringify({ approvalMode: 'unrestricted', model: 'keep', sandbox: { mode: 'disabled', networkAccess: 'keep' } }, null, 2)}\n`,
    )
    const result = await applyHarnessConfig({ kind: 'global' }, { harnesses: ['cursor'], home })
    expect(result.written).toEqual([path])
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(parsed).toMatchObject({
      approvalMode: 'auto-review',
      model: 'keep',
      sandbox: { mode: 'enabled', networkAccess: 'keep' },
    })
    const again = await applyHarnessConfig({ kind: 'global' }, { harnesses: ['cursor'], home })
    expect(again.written).toEqual([])
  })

  it('enables repo Claude sandbox without changing plan defaultMode', async () => {
    const root = await tempDir('harness-claude-')
    const path = join(root, '.claude', 'settings.json')
    await mkdir(join(root, '.claude'), { recursive: true })
    await writeFile(
      path,
      `${JSON.stringify({ permissions: { defaultMode: 'plan' }, sandbox: { enabled: false } }, null, 2)}\n`,
    )
    await applyHarnessConfig({ kind: 'repo', root }, { harnesses: ['claude'] })
    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      permissions: { defaultMode: string }
      sandbox: { enabled: boolean }
    }
    expect(parsed.permissions.defaultMode).toBe('plan')
    expect(parsed.sandbox.enabled).toBe(true)
  })

  it('keeps Cursor project allow/deny while setting auto-review', async () => {
    const root = await tempDir('harness-cli-json-')
    const path = join(root, '.cursor', 'cli.json')
    await mkdir(join(root, '.cursor'), { recursive: true })
    await writeFile(
      path,
      `${JSON.stringify({ permissions: { allow: ['Shell(git)'], deny: ['Shell(sudo)'] } }, null, 2)}\n`,
    )
    await applyHarnessConfig({ kind: 'repo', root }, { harnesses: ['cursor'] })
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(parsed).toMatchObject({
      approvalMode: 'auto-review',
      permissions: { allow: ['Shell(git)'], deny: ['Shell(sudo)'] },
    })
  })
})

describe('TOML apply', () => {
  it('sets Grok auto + workspace-write without dropping unrelated tables', async () => {
    const home = await tempDir('harness-grok-')
    await mkdir(join(home, '.grok'), { recursive: true })
    const config = join(home, '.grok', 'config.toml')
    await writeFile(
      config,
      [
        '[ui]',
        'yolo = false',
        'permission_mode = "ask"',
        '',
        '[[marketplace.sources]]',
        'name = "xAI Official"',
        '',
        '[mcp_servers.CodSpeed]',
        'enabled = true',
        '',
      ].join('\n'),
    )
    await applyHarnessConfig({ kind: 'global' }, { harnesses: ['grok'], home })
    const text = await readFile(config, 'utf8')
    expect(readTomlKey(text, 'ui', 'permission_mode')).toBe('auto')
    expect(readTomlKey(text, 'auto_mode', 'enabled')).toBe(true)
    expect(readTomlKey(text, '', 'default_auto_mode')).toBe(true)
    expect(text).toContain('permission_mode = "auto"')
    expect(text).toContain('yolo = false')
    expect(text).toContain('[[marketplace.sources]]')
    expect(text).toContain('[mcp_servers.CodSpeed]')
    expect(readTomlKey(text, 'sandbox', 'profile')).toBe('workspace-write')
    const sandbox = await readFile(join(home, '.grok', 'sandbox.toml'), 'utf8')
    expect(readTomlKey(sandbox, 'profiles.workspace-write', 'extends')).toBe('workspace')
    expect(readTomlKey(sandbox, 'profiles.workspace-write', 'read_write')).toEqual([
      ...DEFAULT_EXTRA_WRITABLE_ROOTS,
    ])
  })

  it('rewrites Codex auto_review without dropping project trust tables', async () => {
    const home = await tempDir('harness-codex-')
    await mkdir(join(home, '.codex'), { recursive: true })
    const path = join(home, '.codex', 'config.toml')
    await writeFile(
      path,
      [
        'approval_policy = "never"',
        'approvals_reviewer = "guardian_subagent"',
        'sandbox_mode = "danger-full-access"',
        '',
        '[projects."/tmp/example"]',
        'trust_level = "trusted"',
        '',
      ].join('\n'),
    )
    await applyHarnessConfig({ kind: 'global' }, { harnesses: ['codex'], home })
    const text = await readFile(path, 'utf8')
    expect(readTomlKey(text, '', 'approval_policy')).toBe('on-request')
    expect(readTomlKey(text, '', 'approvals_reviewer')).toBe('auto_review')
    expect(readTomlKey(text, '', 'sandbox_mode')).toBe('workspace-write')
    expect(text).toContain('[projects."/tmp/example"]')
    expect(readTomlKey(text, 'sandbox_workspace_write', 'network_access')).toBe(true)
  })

  it('treats commented extra roots as matching when the paths are equal', () => {
    const source = [
      '[profiles.workspace-write]',
      'extends = "workspace"',
      'read_write = [',
      '  "~/.cargo",',
      '  # comment',
      ...DEFAULT_EXTRA_WRITABLE_ROOTS.slice(1).map((root) => `  ${JSON.stringify(root)},`),
      ']',
      '',
    ].join('\n')
    const result = applyTomlPatches(
      source,
      [
        { key: 'extends', table: 'profiles.workspace-write', value: 'workspace' },
        {
          key: 'read_write',
          table: 'profiles.workspace-write',
          value: DEFAULT_EXTRA_WRITABLE_ROOTS,
        },
      ],
      'sandbox.toml',
    )
    expect(result.drifts).toEqual([])
    expect(result.text).toBe(source)
  })
})

describe('check vs apply', () => {
  it('check does not write and apply is idempotent', async () => {
    const home = await tempDir('harness-check-')
    const checked = await checkHarnessConfig({ kind: 'global' }, { harnesses: ['cursor'], home })
    expect(checked.compliant).toBe(false)
    await expect(readFile(join(home, '.cursor', 'cli-config.json'), 'utf8')).rejects.toThrow()
    await applyHarnessConfig({ kind: 'global' }, { harnesses: ['cursor'], home })
    const after = await checkHarnessConfig({ kind: 'global' }, { harnesses: ['cursor'], home })
    expect(after.compliant).toBe(true)
  })
})

describe('CLI', () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => {
    stdout.mockClear()
    stderr.mockClear()
  })

  it('parses dump, global, repo, harness, and home flags', () => {
    expect(parseAgentHarnessConfigArguments(['dump'])).toEqual({
      action: 'dump',
      global: false,
      repos: [],
    })
    expect(
      parseAgentHarnessConfigArguments([
        'apply',
        '--global',
        '--repo',
        '/tmp/a',
        '--repo',
        '/tmp/b',
        '--harness',
        'grok',
        '--home',
        '/tmp/home',
      ]),
    ).toEqual({
      action: 'apply',
      global: true,
      harnesses: ['grok'],
      home: '/tmp/home',
      repos: ['/tmp/a', '/tmp/b'],
    })
    expect(() => parseAgentHarnessConfigArguments(['check'])).toThrow(/--global/)
    expect(() => parseAgentHarnessConfigArguments(['apply', '--harness', 'nope'])).toThrow(
      /unknown harness/,
    )
  })

  it('dumps policy JSON and rejects a missing target', async () => {
    expect(await runAgentHarnessConfigCli(['dump'])).toBe(0)
    const dumped = JSON.parse(String(stdout.mock.calls.at(-1)?.[0])) as {
      cursor: { approvalMode: string }
    }
    expect(dumped.cursor.approvalMode).toBe('auto-review')
    expect(await runAgentHarnessConfigCli(['check'])).toBe(2)
    expect(String(stderr.mock.calls[0]?.[0])).toContain('--global')
  })
})
