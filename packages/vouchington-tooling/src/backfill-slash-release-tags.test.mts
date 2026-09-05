import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse as load } from 'yaml'

const script = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gha/backfill-slash-release-tags.sh',
)
const temporaryDirectories: string[] = []
const gitIdentity = {
  GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
  GIT_AUTHOR_NAME: 'github-actions[bot]',
  GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
  GIT_COMMITTER_NAME: 'github-actions[bot]',
}

type Step = {
  env?: Record<string, string>
  name?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
}

type Workflow = {
  concurrency?: { 'cancel-in-progress'?: boolean; group?: string }
  jobs?: Record<string, { 'runs-on'?: string; steps?: Step[]; 'timeout-minutes'?: number }>
  on?: { workflow_dispatch?: { inputs?: Record<string, { default?: unknown }> } }
  permissions?: Record<string, string>
}

function git(cwd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...gitIdentity, ...extraEnv },
  })
  expect(result.status, result.stderr).toBe(0)
  return result
}

function initRepo() {
  const directory = mkdtempSync(join(tmpdir(), 'slash-tag-backfill-'))
  temporaryDirectories.push(directory)
  git(directory, ['init', '-b', 'main'])
  git(directory, ['config', 'user.name', gitIdentity.GIT_COMMITTER_NAME])
  git(directory, ['config', 'user.email', gitIdentity.GIT_COMMITTER_EMAIL])
  git(directory, ['commit', '--allow-empty', '-m', 'root'])
  return directory
}

function head(cwd: string) {
  return git(cwd, ['rev-parse', 'HEAD']).stdout.trim()
}

function runScript(cwd: string, args: string[]) {
  return spawnSync('bash', [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...gitIdentity },
  })
}

describe('backfill-slash-release-tags', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('rejects missing, unknown, and combined mutating flags', () => {
    const repo = initRepo()
    expect(runScript(repo, []).status).toBe(2)
    expect(runScript(repo, ['--package']).stderr).toContain('usage:')
    expect(runScript(repo, ['--remote']).stderr).toContain('usage:')
    expect(runScript(repo, ['--unknown']).status).toBe(2)
    expect(runScript(repo, ['--package', 'pkg/name']).stderr).toContain('invalid package name')
    expect(runScript(repo, ['--package', 'pkg', '--dry-run', '--push']).stderr).toContain(
      'cannot combine --dry-run with --write or --push',
    )
    expect(runScript(repo, ['--package', 'pkg', '--dry-run', '--write']).stderr).toContain(
      'cannot combine --dry-run with --write or --push',
    )
  })

  it('creates missing slash aliases, skips matches, and fails closed on conflicts', () => {
    const repo = initRepo()
    const first = head(repo)
    git(repo, ['tag', '-a', 'demo-v0.1.0', '-m', 'demo v0.1.0'])
    git(repo, ['commit', '--allow-empty', '-m', 'second'])
    const second = head(repo)
    git(repo, ['tag', '-a', 'demo-v0.1.1', '-m', 'demo v0.1.1'])
    git(repo, ['tag', '-a', 'demo/v0.1.1', '-m', 'demo v0.1.1'])
    git(repo, ['tag', '-a', 'other-v9.9.9', '-m', 'other v9.9.9'])

    const created = runScript(repo, ['--package', 'demo', '--write'])
    expect(created.status, created.stderr).toBe(0)
    expect(created.stdout).toContain(`create demo/v0.1.0 -> ${first}`)
    expect(created.stdout).toContain(`skip demo/v0.1.1 (already at ${second})`)
    expect(git(repo, ['rev-parse', 'demo/v0.1.0^{commit}']).stdout.trim()).toBe(first)
    expect(git(repo, ['tag', '--list', 'other/v*']).stdout.trim()).toBe('')

    git(repo, ['tag', '-a', 'demo-v0.2.0', '-m', 'demo v0.2.0'])
    git(repo, ['commit', '--allow-empty', '-m', 'third'])
    git(repo, ['tag', '-a', 'demo/v0.2.0', '-m', 'other commit'])
    const conflict = runScript(repo, ['--package', 'demo', '--write'])
    expect(conflict.status).toBe(1)
    expect(conflict.stderr).toContain('slash tag demo/v0.2.0 points at')
  })

  it('dry-runs without writing tags and pushes only newly created aliases', () => {
    const repo = initRepo()
    const commit = head(repo)
    git(repo, ['tag', '-a', 'demo-v1.0.0', '-m', 'demo v1.0.0'])
    git(repo, ['tag', '-a', 'demo-v1.0.0-rc.1', '-m', 'demo v1.0.0-rc.1'])

    const implicitDry = runScript(repo, ['--package', 'demo'])
    expect(implicitDry.status, implicitDry.stderr).toBe(0)
    expect(implicitDry.stdout).toContain(`create demo/v1.0.0 -> ${commit}`)
    expect(git(repo, ['tag', '--list', 'demo/v*']).stdout.trim()).toBe('')

    const dry = runScript(repo, ['--package', 'demo', '--dry-run'])
    expect(dry.status, dry.stderr).toBe(0)
    expect(dry.stdout).toContain(`create demo/v1.0.0 -> ${commit}`)
    expect(git(repo, ['tag', '--list', 'demo/v*']).stdout.trim()).toBe('')

    const remote = mkdtempSync(join(tmpdir(), 'slash-tag-remote-'))
    temporaryDirectories.push(remote)
    git(remote, ['init', '--bare'])
    git(repo, ['remote', 'add', 'origin', remote])

    const pushed = runScript(repo, ['--package', 'demo', '--push', '--remote', 'origin'])
    expect(pushed.status, pushed.stderr).toBe(0)
    expect(git(remote, ['tag', '--list']).stdout.split('\n').filter(Boolean).sort()).toEqual([
      'demo/v1.0.0',
      'demo/v1.0.0-rc.1',
    ])

    const second = runScript(repo, ['--package', 'demo', '--push'])
    expect(second.status, second.stderr).toBe(0)
    expect(second.stdout).toContain('nothing to push')
  })

  it('rejects hyphen tags that are not package-v-semver', () => {
    const repo = initRepo()
    git(repo, ['tag', '-a', 'demo-vnot-a-version', '-m', 'bad'])
    const result = runScript(repo, ['--package', 'demo', '--write'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is not <package>-v<semver>')
  })
})

describe('backfill slash release tags workflow', () => {
  const workflowText = readFileSync('.github/workflows/backfill-slash-release-tags.yml', 'utf8')
  const workflow = load(workflowText) as Workflow
  const release = load(readFileSync('.github/workflows/release.yml', 'utf8')) as {
    on?: { workflow_dispatch?: { inputs?: { package?: { options?: string[] } } } }
  }

  it('is a contents-only dispatch that defaults to dry-run and never publishes', () => {
    expect(workflow.on?.workflow_dispatch?.inputs?.dry_run?.default).toBe(true)
    expect(workflow.permissions).toEqual({ contents: 'write' })
    expect(workflow.concurrency).toEqual({
      group: 'backfill-slash-release-tags',
      'cancel-in-progress': false,
    })

    const job = workflow.jobs?.backfill
    expect(job?.['timeout-minutes']).toBeLessThanOrEqual(30)
    expect(job?.['runs-on']).toBe('ubuntu-slim')

    const steps = job?.steps ?? []
    expect(steps.some((step) => step.name === 'Check RELEASE_TOKEN is set')).toBe(true)
    expect(steps.some((step) => step.run?.includes('git config user.name'))).toBe(true)
    const backfill = steps.find((step) => step.name === 'Backfill slash aliases')
    expect(backfill?.run).toContain('backfill-slash-release-tags.sh')
    expect(backfill?.run).toContain('--dry-run')
    expect(backfill?.run).toContain('--push')
    expect(workflowText).not.toContain('npm publish')
    expect(workflowText).not.toContain('gh release create')

    const packages = release.on?.workflow_dispatch?.inputs?.package?.options ?? []
    for (const name of packages) {
      expect(backfill?.run).toContain(`--package ${name}`)
    }

    const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'))
    expect(checkout?.uses).toMatch(/^actions\/checkout@[a-f0-9]{40}$/)
    expect(checkout?.with).toMatchObject({
      'fetch-depth': 0,
      'fetch-tags': true,
      ref: 'main',
    })
    expect(workflowText).toMatch(/uses: actions\/checkout@[a-f0-9]{40} # v\d/)
  })
})
