import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runDockerImageMirrorCommand } from './docker-image-mirror.mts'
import { runTrivyPolicyCommand } from './trivy-policy.mts'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function sink() {
  const chunks: string[] = []
  return { write: (chunk: string) => (chunks.push(chunk), true), text: () => chunks.join('') }
}

function gitRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'policy-cli-'))
  roots.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  execFileSync('git', ['add', '-A'], { cwd: root })
  return root
}

async function run(
  command: typeof runTrivyPolicyCommand,
  args: string[],
): Promise<{ code: number; out: string; err: string }> {
  const stdout = sink()
  const stderr = sink()
  const code = await command(args, { stdout, stderr })
  return { code, out: stdout.text(), err: stderr.text() }
}

describe('vouchington trivy-policy', () => {
  it('exits 1 and prints each violation for a tracked repository', async () => {
    const root = gitRepo({ 'README.md': 'x' })
    await expect(run(runTrivyPolicyCommand, ['--root', root])).resolves.toEqual({
      code: 1,
      out: '',
      err: 'Trivy policy requires OS gates and unfiltered component SBOMs\nTrivy exception registry must be tracked\n',
    })
  })

  it('passes flags through to the policy and exits 0 when compliant', async () => {
    const root = gitRepo({ 'README.md': 'x', 'ci/ignore.yaml': 'vulnerabilities: []\n' })
    const flags = [
      '--root',
      root,
      '--ignore-file',
      'ci/ignore.yaml',
      '--findings-exit-code-env',
      'FINDINGS',
      '--cleanup-url-prefix',
      'https://github.com/a/b/issues/',
      '--min-gates',
      '0',
      '--min-sboms',
      '0',
      '--max-expiry-days',
      '7',
    ]
    await expect(run(runTrivyPolicyCommand, flags)).resolves.toEqual({
      code: 0,
      out: 'Trivy policy: ok\n',
      err: '',
    })
  })

  it('defaults the root to the working directory', async () => {
    const root = gitRepo({ 'README.md': 'x' })
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    const { code, err } = await run(runTrivyPolicyCommand, [])
    expect(code).toBe(1)
    expect(err).toContain('exception registry must be tracked')
  })

  it('exits 2 on bad arguments and 1 outside a git repository', async () => {
    for (const args of [
      ['--nope'],
      ['--min-gates', 'x'],
      ['--max-expiry-days', '99999999999999999999'],
      ['--findings-exit-code-env', '1'],
      ['extra'],
    ]) {
      const result = await run(runTrivyPolicyCommand, args)
      expect(result.code).toBe(2)
      expect(result.err).toContain('trivy-policy [--root <dir>]')
    }
    const outside = mkdtempSync(join(tmpdir(), 'policy-cli-outside-'))
    roots.push(outside)
    const result = await run(runTrivyPolicyCommand, ['--root', outside])
    expect(result).toMatchObject({ code: 1 })
    expect(result.err).toContain('is not inside a git repository')
  })

  it('writes to the process streams by default', async () => {
    const root = gitRepo({ 'README.md': 'x' })
    const stderr = sink()
    vi.spyOn(process.stderr, 'write').mockImplementation(stderr.write as never)
    await expect(runTrivyPolicyCommand(['--root', root])).resolves.toBe(1)
    expect(stderr.text()).toContain('exception registry')
  })
})

describe('vouchington docker-image-mirror', () => {
  it('prints Hub images and exits 1, honouring --mirror', async () => {
    const root = gitRepo({ Dockerfile: 'FROM ubuntu\n' })
    await expect(run(runDockerImageMirrorCommand, ['--root', root])).resolves.toEqual({
      code: 1,
      out: '',
      err: 'Dockerfile: FROM ubuntu\n',
    })
    const workflows = gitRepo({ '.github/workflows/a.yml': 'jobs:\n  b:\n    container: node\n' })
    const result = await run(runDockerImageMirrorCommand, [
      '--root',
      workflows,
      '--mirror',
      'registry.test',
    ])
    expect(result.err).toBe(
      '.github/workflows/a.yml#b container: node must come from registry.test/\n',
    )
  })

  it('exits 0 when compliant, 2 on bad arguments, 1 outside git', async () => {
    const root = gitRepo({ Dockerfile: 'FROM mirror.gcr.io/library/ubuntu\n' })
    await expect(run(runDockerImageMirrorCommand, ['--root', root])).resolves.toEqual({
      code: 0,
      out: 'Docker image mirror policy: ok\n',
      err: '',
    })
    const bad = await run(runDockerImageMirrorCommand, ['--nope'])
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('docker-image-mirror [--root <dir>]')
    const outside = mkdtempSync(join(tmpdir(), 'policy-cli-outside-'))
    roots.push(outside)
    expect((await run(runDockerImageMirrorCommand, ['--root', outside])).code).toBe(1)
  })

  it('defaults the root and streams to the process', async () => {
    const root = gitRepo({ Dockerfile: 'FROM mirror.gcr.io/library/ubuntu\n' })
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    const stdout = sink()
    vi.spyOn(process.stdout, 'write').mockImplementation(stdout.write as never)
    await expect(runDockerImageMirrorCommand([])).resolves.toBe(0)
    expect(stdout.text()).toBe('Docker image mirror policy: ok\n')
  })
})
