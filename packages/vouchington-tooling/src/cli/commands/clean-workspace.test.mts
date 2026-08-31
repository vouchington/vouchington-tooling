import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptPath = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gha/clean-workspace.sh',
)

function runCleanWorkspace(options: {
  extraKeep?: string
  headRepo?: string
  prAuthor: string
  preserveNodeModules?: boolean
}): {
  fullIndexRecovery: boolean
  keptDependency: boolean
  keptExtra: boolean
  keptNestedDependency: boolean
  removedJunk: boolean
  sparseCheckoutCleared: boolean
} {
  const workspace = mkdtempSync(join(tmpdir(), 'clean-workspace-test-'))
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: workspace })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: workspace })
    execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd: workspace })
    writeFileSync(join(workspace, '.gitignore'), 'node_modules/\nkept/\n')
    writeFileSync(join(workspace, 'tracked.txt'), 'tracked\n')
    execFileSync('git', ['add', '.'], { cwd: workspace })
    execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: workspace })
    execFileSync('git', ['config', 'extensions.worktreeConfig', 'true'], { cwd: workspace })
    execFileSync('git', ['config', '--worktree', 'core.sparseCheckout', 'true'], {
      cwd: workspace,
    })
    execFileSync('git', ['config', '--local', 'core.sparseCheckoutCone', 'true'], {
      cwd: workspace,
    })

    mkdirSync(join(workspace, 'node_modules/example'), { recursive: true })
    writeFileSync(join(workspace, 'node_modules/example/index.js'), 'preserved\n')
    mkdirSync(join(workspace, 'packages/app/node_modules/example'), { recursive: true })
    writeFileSync(join(workspace, 'packages/app/node_modules/example/index.js'), 'preserved\n')
    mkdirSync(join(workspace, 'node_modules/.cache'), { recursive: true })
    writeFileSync(join(workspace, 'node_modules/.cache/tsbuildinfo'), 'stale\n')
    mkdirSync(join(workspace, 'kept'), { recursive: true })
    writeFileSync(join(workspace, 'kept/file.txt'), 'keep\n')
    writeFileSync(join(workspace, 'junk.txt'), 'removed\n')

    const output = execFileSync('bash', [scriptPath], {
      cwd: workspace,
      env: {
        ...process.env,
        BASE_REF: 'main',
        BASE_REPO: 'example/repo',
        DEEPEN: 'false',
        EVENT_NAME: 'pull_request',
        EXTRA_KEEP: options.extraKeep ?? '',
        GITHUB_TOKEN: '',
        GITHUB_WORKSPACE: workspace,
        HEAD_REPO: options.headRepo === undefined ? 'example/repo' : options.headRepo,
        PR_AUTHOR: options.prAuthor,
        PRESERVE_NODE_MODULES: String(options.preserveNodeModules ?? true),
        RUNNER_TOOL_CACHE: workspace,
      },
      encoding: 'utf8',
    })

    return {
      fullIndexRecovery: output.includes('Full workspace index recovery'),
      keptDependency: existsSync(join(workspace, 'node_modules/example/index.js')),
      keptExtra: existsSync(join(workspace, 'kept/file.txt')),
      keptNestedDependency: existsSync(
        join(workspace, 'packages/app/node_modules/example/index.js'),
      ),
      removedJunk: !existsSync(join(workspace, 'junk.txt')),
      sparseCheckoutCleared: ['core.sparseCheckout', 'core.sparseCheckoutCone'].every((key) => {
        for (const scope of ['--worktree', '--local']) {
          try {
            execFileSync('git', ['config', scope, '--get', key], { cwd: workspace })
            return false
          } catch {
            // Missing is the expected state.
          }
        }
        return true
      }),
    }
  } finally {
    rmSync(workspace, { force: true, recursive: true })
  }
}

describe('clean-workspace', () => {
  it('preserves dependencies for trusted authors and full-cleans Dependabot', () => {
    expect(runCleanWorkspace({ prAuthor: 'maintainer' })).toEqual({
      fullIndexRecovery: false,
      keptDependency: true,
      keptExtra: false,
      keptNestedDependency: true,
      removedJunk: true,
      sparseCheckoutCleared: true,
    })
    expect(runCleanWorkspace({ prAuthor: 'dependabot[bot]' })).toEqual({
      fullIndexRecovery: false,
      keptDependency: false,
      keptExtra: false,
      keptNestedDependency: false,
      removedJunk: true,
      sparseCheckoutCleared: true,
    })
  })

  it('can remove every dependency tree on a trusted run when preservation is disabled', () => {
    expect(runCleanWorkspace({ prAuthor: 'maintainer', preserveNodeModules: false })).toEqual({
      fullIndexRecovery: false,
      keptDependency: false,
      keptExtra: false,
      keptNestedDependency: false,
      removedJunk: true,
      sparseCheckoutCleared: true,
    })
  })

  it('full-cleans fork pull requests and honors extra-keep on trusted runs', () => {
    expect(runCleanWorkspace({ headRepo: 'fork/repo', prAuthor: 'contributor' })).toEqual({
      fullIndexRecovery: false,
      keptDependency: false,
      keptExtra: false,
      keptNestedDependency: false,
      removedJunk: true,
      sparseCheckoutCleared: true,
    })
    expect(runCleanWorkspace({ extraKeep: 'kept', prAuthor: 'maintainer' })).toMatchObject({
      keptDependency: true,
      keptExtra: true,
      removedJunk: true,
    })
  })

  it('derives fork metadata from native GitHub event context', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'clean-workspace-event-'))
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: workspace })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: workspace })
      execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd: workspace })
      writeFileSync(join(workspace, '.gitignore'), 'node_modules/\n')
      writeFileSync(join(workspace, 'tracked.txt'), 'tracked\n')
      execFileSync('git', ['add', '.'], { cwd: workspace })
      execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: workspace })
      mkdirSync(join(workspace, 'node_modules/example'), { recursive: true })
      writeFileSync(join(workspace, 'node_modules/example/index.js'), 'preserved\n')
      writeFileSync(join(workspace, 'junk.txt'), 'removed\n')
      const eventPath = join(workspace, 'event.json')
      writeFileSync(
        eventPath,
        JSON.stringify({
          pull_request: {
            head: { repo: { full_name: 'example/repo' } },
            user: { login: 'maintainer' },
          },
        }),
      )

      execFileSync('bash', [scriptPath], {
        cwd: workspace,
        env: {
          ...process.env,
          BASE_REF: 'main',
          BASE_REPO: '',
          DEEPEN: 'false',
          EVENT_NAME: '',
          EXTRA_KEEP: '',
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_REPOSITORY: 'example/repo',
          GITHUB_TOKEN: '',
          GITHUB_WORKSPACE: workspace,
          HEAD_REPO: '',
          PR_AUTHOR: '',
          PRESERVE_NODE_MODULES: 'true',
          RUNNER_TOOL_CACHE: workspace,
        },
        stdio: 'pipe',
      })

      expect(existsSync(join(workspace, 'node_modules/example/index.js'))).toBe(true)
      expect(existsSync(join(workspace, 'junk.txt'))).toBe(false)
    } finally {
      rmSync(workspace, { force: true, recursive: true })
    }
  })

  it('fails closed on pull_request events when fork metadata is missing', () => {
    expect(
      runCleanWorkspace({
        headRepo: '',
        prAuthor: 'maintainer',
      }),
    ).toEqual({
      fullIndexRecovery: false,
      keptDependency: false,
      keptExtra: false,
      keptNestedDependency: false,
      removedJunk: true,
      sparseCheckoutCleared: true,
    })
  })

  it('restores an actual sparse index while leaving isolated global config untouched', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'clean-workspace-sparse-test-'))
    const configRoot = mkdtempSync(join(tmpdir(), 'clean-workspace-global-config-'))
    const globalConfig = join(configRoot, 'global.gitconfig')
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: workspace })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: workspace })
      execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd: workspace })
      mkdirSync(join(workspace, 'included'), { recursive: true })
      mkdirSync(join(workspace, 'omitted'), { recursive: true })
      writeFileSync(join(workspace, 'included/tracked.txt'), 'included\n')
      writeFileSync(join(workspace, 'omitted/tracked.txt'), 'omitted\n')
      execFileSync('git', ['add', '.'], { cwd: workspace })
      execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: workspace })
      execFileSync('git', ['sparse-checkout', 'set', 'included'], { cwd: workspace })
      expect(existsSync(join(workspace, 'omitted/tracked.txt'))).toBe(false)
      execFileSync('git', ['config', '--file', globalConfig, 'core.sparseCheckout', 'true'])
      execFileSync('git', ['config', '--file', globalConfig, 'core.sparseCheckoutCone', 'true'])

      execFileSync('bash', [scriptPath], {
        cwd: workspace,
        env: {
          ...process.env,
          BASE_REPO: 'example/repo',
          DEEPEN: 'false',
          EVENT_NAME: 'push',
          GIT_CONFIG_GLOBAL: globalConfig,
          GITHUB_WORKSPACE: workspace,
          RUNNER_TOOL_CACHE: workspace,
        },
        stdio: 'pipe',
      })

      expect(readFileSync(join(workspace, 'omitted/tracked.txt'), 'utf8')).toBe('omitted\n')
      expect(
        execFileSync('git', ['ls-files', '-v'], { cwd: workspace, encoding: 'utf8' }),
      ).not.toMatch(/^S /mu)
      expect(
        execFileSync('git', ['config', '--file', globalConfig, 'core.sparseCheckout'], {
          encoding: 'utf8',
        }).trim(),
      ).toBe('true')
    } finally {
      rmSync(workspace, { force: true, recursive: true })
      rmSync(configRoot, { force: true, recursive: true })
    }
  })

  it('runs full index recovery only after corruption is detected', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'clean-workspace-corrupt-index-'))
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: workspace })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: workspace })
      execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd: workspace })
      writeFileSync(join(workspace, 'tracked.txt'), 'tracked\n')
      execFileSync('git', ['add', '.'], { cwd: workspace })
      execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: workspace })
      writeFileSync(join(workspace, '.git/index'), 'corrupt-index')

      const output = execFileSync('bash', [scriptPath], {
        cwd: workspace,
        encoding: 'utf8',
        env: {
          ...process.env,
          BASE_REPO: 'example/repo',
          DEEPEN: 'false',
          EVENT_NAME: 'push',
          GITHUB_WORKSPACE: workspace,
          RUNNER_TOOL_CACHE: workspace,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      expect(output).toContain('Git index corruption remained after bounded cleanup')
      expect(output).toMatch(/Full workspace index recovery restored 1 tracked paths in \d+s\./u)
      expect(readFileSync(join(workspace, 'tracked.txt'), 'utf8')).toBe('tracked\n')
    } finally {
      rmSync(workspace, { force: true, recursive: true })
    }
  })
})
