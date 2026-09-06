import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyHarnessConfig,
  checkHarnessConfig,
  dumpHarnessPolicy,
  planHarnessConfig,
} from './index.mts'
import { parseAgentHarnessConfigArguments, runAgentHarnessConfigCli } from './cli.mts'
import { applyJsonPatches } from './merge-json.mts'
import { applyTomlPatches, readTomlKey } from './merge-toml.mts'
import { formatTomlValue, parseTomlValue } from './toml-value.mts'
import { CURSOR_APPROVAL_MODE, DEFAULT_EXTRA_WRITABLE_ROOTS } from './policy.mts'
import * as policy from './policy.mts'

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

describe('dumpHarnessPolicy', () => {
  it('maps every harness to classifier-auto and sandbox, never YOLO keys', () => {
    const dump = JSON.stringify(dumpHarnessPolicy())
    expect(dumpHarnessPolicy().claude.defaultMode).toBe('auto')
    expect(dumpHarnessPolicy().claude.sandboxFailIfUnavailable).toBe(true)
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
      sandbox: { enabled: boolean; failIfUnavailable: boolean }
    }
    expect(parsed.permissions.defaultMode).toBe('plan')
    expect(parsed.sandbox).toMatchObject({ enabled: true, failIfUnavailable: true })
  })

  it('gives Claude the same writable roots as Codex/Grok/Cursor while keeping custom entries (B1)', async () => {
    const root = await tempDir('harness-claude-allowwrite-')
    const path = join(root, '.claude', 'settings.json')
    await mkdir(join(root, '.claude'), { recursive: true })
    await writeFile(
      path,
      `${JSON.stringify({ sandbox: { enabled: false, filesystem: { allowWrite: ['/tmp/my-custom-root'] } } }, null, 2)}\n`,
    )
    await applyHarnessConfig(
      { kind: 'repo', root },
      { harnesses: ['claude'], extraWritableRoots: ['/tmp/extra-root'] },
    )
    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      sandbox: { enabled: boolean; filesystem: { allowWrite: string[] } }
    }
    expect(parsed.sandbox.enabled).toBe(true)
    expect(parsed.sandbox.filesystem.allowWrite).toEqual(['/tmp/my-custom-root', '/tmp/extra-root'])
    const again = await applyHarnessConfig(
      { kind: 'repo', root },
      { harnesses: ['claude'], extraWritableRoots: ['/tmp/extra-root'] },
    )
    expect(again.written).toEqual([])
  })

  it('leaves unsupported Cursor project CLI config untouched', async () => {
    const root = await tempDir('harness-cli-json-')
    const path = join(root, '.cursor', 'cli.json')
    await mkdir(join(root, '.cursor'), { recursive: true })
    await writeFile(
      path,
      `${JSON.stringify({ permissions: { allow: ['Shell(git)'], deny: ['Shell(sudo)'] } }, null, 2)}\n`,
    )
    await applyHarnessConfig({ kind: 'repo', root }, { harnesses: ['cursor'] })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
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
    expect(readTomlKey(text, 'sandbox', 'profile')).toBeUndefined()
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

describe('TOML apply validates output with a real parser', () => {
  it('refuses to silently duplicate a dotted-key table (B4 regression)', () => {
    expect(() =>
      applyTomlPatches(
        'sandbox.profile = "ask"\n',
        [{ key: 'profile', table: 'sandbox', value: 'workspace-write' }],
        '~/.grok/config.toml',
      ),
    ).toThrow(/produced invalid TOML/)
  })
})

describe('JSON union merge', () => {
  it('creates the array when the current value is missing', () => {
    const result = applyJsonPatches(
      '{}',
      [
        {
          merge: 'union',
          path: ['sandbox', 'filesystem', 'allowWrite'],
          value: ['/tmp/a', '/tmp/b'],
        },
      ],
      'settings.json',
    )
    expect(result.drifts).toEqual([
      {
        current: undefined,
        desired: ['/tmp/a', '/tmp/b'],
        key: 'sandbox.filesystem.allowWrite',
        path: 'settings.json',
      },
    ])
    expect(JSON.parse(result.text)).toMatchObject({
      sandbox: { filesystem: { allowWrite: ['/tmp/a', '/tmp/b'] } },
    })
  })

  it('preserves existing custom entries while adding missing ones', () => {
    const source = JSON.stringify({
      sandbox: { filesystem: { allowWrite: ['/tmp/custom', '/tmp/a'] } },
    })
    const result = applyJsonPatches(
      source,
      [
        {
          merge: 'union',
          path: ['sandbox', 'filesystem', 'allowWrite'],
          value: ['/tmp/a', '/tmp/b'],
        },
      ],
      'settings.json',
    )
    expect(result.drifts).toHaveLength(1)
    const parsed = JSON.parse(result.text) as {
      sandbox: { filesystem: { allowWrite: string[] } }
    }
    expect(parsed.sandbox.filesystem.allowWrite).toEqual(['/tmp/custom', '/tmp/a', '/tmp/b'])
  })

  it('is idempotent once every value is already present, regardless of order', () => {
    const source = JSON.stringify({
      sandbox: { filesystem: { allowWrite: ['/tmp/b', '/tmp/custom', '/tmp/a'] } },
    })
    const result = applyJsonPatches(
      source,
      [
        {
          merge: 'union',
          path: ['sandbox', 'filesystem', 'allowWrite'],
          value: ['/tmp/a', '/tmp/b'],
        },
      ],
      'settings.json',
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

describe('repo prerequisites', () => {
  it('requires Codex project trust without writing it', async () => {
    const home = await tempDir('harness-codex-trust-home-')
    const root = await tempDir('harness-codex-trust-repo-')
    await applyHarnessConfig({ kind: 'repo', root }, { harnesses: ['codex'], home })
    const missing = await checkHarnessConfig({ kind: 'repo', root }, { harnesses: ['codex'], home })
    expect(missing.prerequisites).toMatchObject([{ satisfied: false }])
    const path = join(home, '.codex', 'config.toml')
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(path, `[projects.${JSON.stringify(root)}]\ntrust_level = "trusted"\n`)
    const trusted = await checkHarnessConfig({ kind: 'repo', root }, { harnesses: ['codex'], home })
    expect(trusted.prerequisites).toMatchObject([{ satisfied: true }])
    expect(trusted.compliant).toBe(true)
    expect(
      (await applyHarnessConfig({ kind: 'repo', root }, { harnesses: ['codex'], home })).compliant,
    ).toBe(true)
  })

  it('surfaces manual Grok activation and Cursor global mode', async () => {
    const home = await tempDir('harness-prerequisite-home-')
    const root = await tempDir('harness-prerequisite-repo-')
    const grok = await checkHarnessConfig({ kind: 'repo', root }, { harnesses: ['grok'], home })
    expect(grok.prerequisites).toMatchObject([{ satisfied: false }])
    const missing = await checkHarnessConfig(
      { kind: 'repo', root },
      { harnesses: ['cursor'], home },
    )
    expect(missing.prerequisites).toMatchObject([{ satisfied: false }])
    const blockedHome = join(home, 'not-a-directory')
    await writeFile(blockedHome, 'file')
    await expect(
      checkHarnessConfig({ kind: 'repo', root }, { harnesses: ['cursor'], home: blockedHome }),
    ).rejects.toThrow()
    await applyHarnessConfig({ kind: 'global' }, { harnesses: ['cursor'], home })
    const cursor = await checkHarnessConfig({ kind: 'repo', root }, { harnesses: ['cursor'], home })
    expect(cursor.prerequisites).toMatchObject([{ satisfied: true }])
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
    expect(() => parseAgentHarnessConfigArguments(['check', '--repo'])).toThrow(/requires a value/)
    expect(() => parseAgentHarnessConfigArguments(['check', '--wat'])).toThrow(/unknown/)
    expect(() => parseAgentHarnessConfigArguments([])).toThrow(
      /unknown agent-harness-config action/,
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

  it('checks drift then applies under an isolated home', async () => {
    const home = await tempDir('harness-cli-home-')
    expect(
      await runAgentHarnessConfigCli(['check', '--global', '--home', home, '--harness', 'cursor']),
    ).toBe(1)
    expect(stdout.mock.calls.map(String).join('')).toMatch(/approvalMode/)
    expect(
      await runAgentHarnessConfigCli(['apply', '--global', '--home', home, '--harness', 'cursor']),
    ).toBe(0)
    expect(
      await runAgentHarnessConfigCli(['check', '--global', '--home', home, '--harness', 'cursor']),
    ).toBe(0)
  })

  it('checks a repo without harness or home flags', async () => {
    const root = await tempDir('harness-cli-repo-')
    expect(await runAgentHarnessConfigCli(['check', '--repo', root])).toBe(1)
    expect(stdout.mock.calls.map(String).join('')).toMatch(/missing /)
  })

  it('returns nonzero when apply leaves a manual prerequisite', async () => {
    const root = await tempDir('harness-cli-grok-repo-')
    expect(await runAgentHarnessConfigCli(['apply', '--repo', root, '--harness', 'grok'])).toBe(1)
    expect(stdout.mock.calls.map(String).join('')).toMatch(/required grok prerequisite/)
  })

  it('stringifies non-Error CLI failures', async () => {
    const spy = vi.spyOn(policy, 'dumpHarnessPolicy').mockImplementation(() => {
      throw 'boom'
    })
    expect(await runAgentHarnessConfigCli(['dump'])).toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toBe('boom\n')
    spy.mockRestore()
    expect(dumpHarnessPolicy().cursor.approvalMode).toBe(CURSOR_APPROVAL_MODE)
  })
})

describe('edge coverage', () => {
  it('covers JSON, TOML, and repo/global remaining branches', async () => {
    expect(dumpHarnessPolicy(['/tmp/extra']).extraWritableRoots).toEqual(['/tmp/extra'])
    expect(planHarnessConfig({ kind: 'global' }).files.length).toBeGreaterThan(0)
    expect(applyJsonPatches('', [], 'x.json').text).toBe('{}\n')
    expect(applyJsonPatches('{}', [{ path: [], value: 1 }], 'x.json').drifts).toHaveLength(1)
    expect(() => applyJsonPatches('[]', [{ path: ['a'], value: 1 }], 'x.json')).toThrow(
      /JSON object/,
    )
    expect(formatTomlValue(false)).toBe('false')
    expect(formatTomlValue(true)).toBe('true')
    expect(parseTomlValue(`'~/.cargo'`, 0).value).toBe('~/.cargo')
    expect(parseTomlValue('"a\\nb\\tc\\\\"', 0).value).toBe('a\nb\tc\\')
    expect(parseTomlValue('false', 0).value).toBe(false)
    expect(() => parseTomlValue('"unterminated', 0)).toThrow(/unterminated/)
    expect(() => parseTomlValue('"\\', 0)).toThrow(/unterminated/)
    expect(() => parseTomlValue('[1]', 0)).toThrow(/array value/)
    expect(() => parseTomlValue('123', 0)).toThrow(/unsupported TOML value/)
    const preExisting = applyTomlPatches(
      '[]\n[sandbox]\nprofile = "workspace-write"\n',
      [{ key: 'profile', table: 'sandbox', value: 'workspace-write' }],
      'p.toml',
    )
    expect(preExisting.drifts).toEqual([])
    expect(preExisting.text).toBe('[]\n[sandbox]\nprofile = "workspace-write"\n')
    expect(
      applyTomlPatches('', [{ key: 'enabled', table: '', value: false }], 'root.toml').text,
    ).toContain('enabled = false')
    const noNl = applyTomlPatches(
      'sandbox_mode = "read-only"',
      [
        { key: 'sandbox_mode', table: '', value: 'workspace-write' },
        { key: 'profile', table: 'sandbox', value: 'workspace-write' },
      ],
      'c.toml',
    )
    expect(noNl.text).toContain('sandbox_mode = "workspace-write"')
    expect(noNl.text).toContain('[sandbox]')
    const quoted = applyTomlPatches(
      "read_write = ['~/.cargo']\n[]\n",
      [{ key: 'read_write', table: '', value: ['~/.cargo'] }],
      's.toml',
    )
    expect(quoted.drifts).toEqual([])
    expect(() =>
      applyTomlPatches(
        '[sandbox]profile = "ask"',
        [{ key: 'profile', table: 'sandbox', value: 'workspace-write' }],
        'p.toml',
      ),
    ).toThrow(/produced invalid TOML/)
    expect(
      applyTomlPatches(
        '[ui]\npermission_mode = "ask"',
        [{ key: 'enabled', table: 'auto_mode', value: true }],
        'u.toml',
      ).text,
    ).toContain('[auto_mode]')
    const home = await tempDir('harness-edges-')
    await applyHarnessConfig({ kind: 'global' }, { harnesses: ['claude'], home })
    const root = await tempDir('harness-repo-all-')
    await applyHarnessConfig({ kind: 'repo', root }, { extraWritableRoots: ['/tmp/extra-root'] })
    const sandbox = await readFile(join(root, '.grok', 'sandbox.toml'), 'utf8')
    expect(readTomlKey(sandbox, 'profiles.workspace-write', 'read_write')).toEqual([
      '/tmp/extra-root',
    ])
    await mkdir(join(home, '.cursor'), { recursive: true })
    await mkdir(join(home, '.cursor', 'cli-config.json'))
    await expect(
      applyHarnessConfig({ kind: 'global' }, { harnesses: ['cursor'], home }),
    ).rejects.toThrow()
  })
})
