import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildSharedContext } from '../../shared-context/index.mts'
import { runWorkspaceRegistryCheckCommand } from './workspace-registry-check.mts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function sink() {
  const chunks: string[] = []
  return { write: (chunk: string) => (chunks.push(chunk), true), text: () => chunks.join('') }
}

function gitRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'registry-cli-'))
  roots.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  execFileSync('git', ['add', '-A'], { cwd: root })
  return root
}

async function run(args: string[]) {
  const stdout = sink()
  const stderr = sink()
  const code = await runWorkspaceRegistryCheckCommand(args, { stdout, stderr })
  return { code, out: stdout.text(), err: stderr.text() }
}

const defaults = {
  'package.json': '{}',
  'packages/a/package.json': '{}',
  '.syncpackrc.json': '{"source":["package.json","packages/*/package.json"]}',
  'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
  '.github/ci-path-filters.yml':
    'tooling:\n  - "**/package.json"\n  - package.json\n  - packages/*/package.json\n',
}

describe('vouchington workspace-registry-check', () => {
  it('prints ok and exits 0 when every registry covers the manifests', async () => {
    const root = gitRepo(defaults)
    await expect(run(['--root', root])).resolves.toEqual({
      code: 0,
      out: 'Workspace registry coverage: ok\n',
      err: '',
    })
  })

  it('prints one line per violation and exits 1', async () => {
    const root = gitRepo({
      ...defaults,
      '.syncpackrc.json':
        '{"source":["package.json","packages/*/package.json","gone/package.json"]}',
    })
    await expect(run(['--root', root])).resolves.toEqual({
      code: 1,
      out: '',
      err: 'stale fixed .syncpackrc.json source entries: gone/package.json\n',
    })
  })

  it('reads configured files, group names and prefix', async () => {
    const root = gitRepo({
      'package.json': '{}',
      'sync.json': '{"source":["package.json"]}',
      'ws.yml': 'packages: []\n',
      'paths.yml': 'ci:\n  - all\n  - package.json\nrt-ci:\n  - other\n',
    })
    const result = await run(
      `--root ${root} --syncpack-config sync.json --workspace-file ws.yml --path-filters paths.yml --tooling-group ci --trigger-only-glob all --runtime-prefix rt-`.split(
        ' ',
      ),
    )
    expect(result).toEqual({
      code: 1,
      out: '',
      err: 'rt-ci positive path filters differ from its primary group\n',
    })
  })

  it('treats a trigger-only glob override as registering nothing', async () => {
    const root = gitRepo(defaults)
    const result = await run(['--root', root, '--trigger-only-glob', 'package.json'])
    expect(result.code).toBe(0)
  })

  it('fails when a registry file is missing', async () => {
    const root = gitRepo({ 'package.json': '{}' })
    const result = await run(['--root', root])
    expect(result.code).toBe(1)
    expect(result.err).toMatch(/^vouchington: ENOENT/u)
  })

  it('fails outside a git repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'registry-cli-'))
    roots.push(root)
    const buildContext = async (dir: string) => ({
      repoRoot: dir,
      isInsideGitRepo: false,
      trackedFiles: [],
      trackedFileSet: new Set<string>(),
    })
    const stderr = sink()
    const code = await runWorkspaceRegistryCheckCommand(['--root', root], { buildContext, stderr })
    expect(code).toBe(1)
    expect(stderr.text()).toBe(`vouchington: ${root} is not inside a git repository\n`)
  })

  it('defaults the root to the current directory and the sinks to the process streams', async () => {
    const root = gitRepo(defaults)
    const seen: string[] = []
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const buildContext = async (dir: string) => {
      seen.push(dir)
      return buildSharedContext(root)
    }
    const code = await runWorkspaceRegistryCheckCommand([], { buildContext })
    expect(code).toBe(0)
    expect(seen).toEqual([process.cwd()])
    expect(out).toHaveBeenCalledWith('Workspace registry coverage: ok\n')
    vi.restoreAllMocks()
  })

  it('exits 2 on an unknown flag or an empty runtime prefix', async () => {
    const unknown = await run(['--nope'])
    expect(unknown.code).toBe(2)
    expect(unknown.err).toContain('workspace-registry-check [--root <dir>]')
    const empty = await run(['--runtime-prefix', ''])
    expect(empty.code).toBe(2)
    expect(empty.err).toContain('--runtime-prefix needs a non-empty value')
  })
})
