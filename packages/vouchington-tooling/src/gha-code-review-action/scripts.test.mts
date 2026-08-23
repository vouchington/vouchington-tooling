import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const actionDir = resolve('.github/actions/code-review')

function git(args: string[], cwd: string) {
  return spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: cwd },
  })
}

describe('code-review worktree scripts', () => {
  it('creates worktrees under OS tmpdir', () => {
    const script = join(actionDir, 'worktree-create.sh')
    const missing = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_WORKSPACE: '', TMPDIR: tmpdir() },
    })
    expect(missing.status).not.toBe(0)

    const repo = mkdtempSync(join(tmpdir(), 'code-review-repo-'))
    const trees = mkdtempSync(join(tmpdir(), 'code-review-tmp-'))
    try {
      expect(git(['init'], repo).status).toBe(0)
      writeFileSync(join(repo, 'README'), 'ok\n')
      expect(git(['add', 'README'], repo).status).toBe(0)
      expect(git(['commit', '-m', 'init'], repo).status).toBe(0)
      const created = spawnSync('bash', [script], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_WORKSPACE: repo, TMPDIR: trees },
      })
      expect(created.status).toBe(0)
      const dir = created.stdout.trim()
      expect(dir.startsWith(trees)).toBe(true)
      expect(dir).toContain('code-review-wt.')
      expect(existsSync(dir)).toBe(true)
    } finally {
      spawnSync('bash', [join(actionDir, 'cleanup-worktrees.sh')], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_WORKSPACE: repo, TMPDIR: trees },
      })
      rmSync(repo, { recursive: true, force: true })
      rmSync(trees, { recursive: true, force: true })
    }
  })

  it('is a no-op cleanup when the workspace is not a git worktree list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cleanup-wt-'))
    try {
      const result = spawnSync('bash', [join(actionDir, 'cleanup-worktrees.sh')], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_WORKSPACE: dir, TMPDIR: dir },
      })
      expect(result.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('stage-runtime.sh', () => {
  it('copies the action and payload CLI into runner temp', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage-runtime-'))
    const output = join(dir, 'github-output')
    const envFile = join(dir, 'github-env')
    writeFileSync(output, '')
    writeFileSync(envFile, '')
    try {
      const result = spawnSync('bash', [join(actionDir, 'stage-runtime.sh')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_ACTION_PATH: actionDir,
          RUNNER_TEMP: dir,
          GITHUB_OUTPUT: output,
          GITHUB_ENV: envFile,
        },
      })
      expect(result.status, result.stderr).toBe(0)
      const dest = join(dir, 'vouchington-tooling-runtime')
      expect(readFileSync(output, 'utf8')).toContain(`root=${dest}`)
      expect(readFileSync(envFile, 'utf8')).toContain(`VOUCHINGTON_TOOLING_ROOT=${dest}`)
      expect(existsSync(join(dest, '.nvmrc'))).toBe(true)
      expect(
        existsSync(join(dest, 'packages/vouchington-tooling/src/gha-review-payload/cli.mts')),
      ).toBe(true)
      expect(existsSync(join(dest, '.github/actions/code-review/worktree-create.sh'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
