import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const buildPrompt = resolve('.github/actions/opencode-code-review/build-prompt.sh')
const installCli = resolve('.github/actions/opencode-code-review/install-opencode-cli.sh')
const installText = readFileSync(installCli, 'utf8')
const actionText = readFileSync('.github/actions/opencode-code-review/action.yml', 'utf8')
const pinnedVersion = /OPENCODE_VERSION: '([^']+)'/u.exec(actionText)?.[1]

describe('opencode-code-review scripts', () => {
  it('rejects extra_prompt unless the caller is private and writes a file-only prompt', () => {
    const root = mkdtempSync(join(tmpdir(), 'opencode-prompt-'))
    const workspace = join(root, 'workspace')
    const trusted = join(workspace, '.trusted-review-prompt')
    const output = join(root, 'github-output')
    mkdirSync(join(trusted, '.agents/skills/agent-workflow'), { recursive: true })
    mkdirSync(join(trusted, 'docs/prompts'), { recursive: true })
    writeFileSync(join(trusted, '.agents/skills/agent-workflow/code-review-prompt.md'), 'PROMPT\n')
    writeFileSync(join(trusted, 'docs/prompts/code-review-inline-comments.md'), 'INLINE\n')
    writeFileSync(output, '')
    const env = {
      ...process.env,
      GITHUB_ACTION_PATH: resolve('.github/actions/opencode-code-review'),
      GITHUB_OUTPUT: output,
      GITHUB_WORKSPACE: workspace,
      RUNNER_TEMP: root,
      REVIEW_TARGET: 'owner/repo#1',
      PROMPT_PATH: '.agents/skills/agent-workflow/code-review-prompt.md',
      INLINE_PROMPT_PATH: 'docs/prompts/code-review-inline-comments.md',
      EXTRA_PROMPT: 'bonus',
      REPO_PRIVATE: 'false',
    }
    try {
      const denied = spawnSync('bash', [buildPrompt], { encoding: 'utf8', env })
      expect(denied.status).not.toBe(0)
      expect(denied.stderr + denied.stdout).toContain('private repositories')
      const allowed = spawnSync('bash', [buildPrompt], {
        encoding: 'utf8',
        env: { ...env, REPO_PRIVATE: 'true' },
      })
      expect(allowed.status).toBe(0)
      const prompt = readFileSync(join(root, 'opencode-review-prompt.md'), 'utf8')
      expect(prompt).toContain('Target: owner/repo#1')
      expect(prompt).toContain('PROMPT')
      expect(prompt).toContain('INLINE')
      expect(prompt).toContain('bonus')
      expect(prompt).toContain('OpenCode cannot use the Agent or Task tool')
      expect(readFileSync(output, 'utf8')).toContain('available=true')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('pins OpenCode releases and delegates install to the packaged GitHub-release helper', () => {
    expect(installText).toContain('anomalyco/opencode')
    expect(installText).toContain('install-github-release.sh')
    expect(installText).toContain('--expected-sha256')
    expect(pinnedVersion).toMatch(/^\d+\.\d+\.\d+$/u)
    expect(installText).toContain(`${pinnedVersion}-Linux-x86_64`)
    expect(installText).toContain(`${pinnedVersion}-Linux-aarch64`)
    expect(installText).toContain(`${pinnedVersion}-Darwin-x86_64`)
    expect(installText).toContain(`${pinnedVersion}-Darwin-arm64`)
    expect(installText).toContain(
      'd910c3ed7613bb5791a328904615d41cc25b7d3a6b470e3199ab0426a995b38a',
    )
    expect(installText).toContain(
      'd30d2cba74617f4e7b96e25563c9572ffe453f9eae70fc0df16286813537ee72',
    )
    expect(installText).toContain(
      '405559e5873a9131ff6bcafc413f46d4f199b4401f232d00bcd301d97ea7cdfc',
    )
    expect(installText).toContain(
      '72f4b6029af185eb030995cfa062d038914e3142c9aa38f714fe56448e6e87d2',
    )
    expect(installText).toContain('opencode-linux-x64.tar.gz')
    const root = mkdtempSync(join(tmpdir(), 'opencode-install-'))
    const actionPath = join(root, '.github/actions/opencode-code-review')
    const helper = join(root, 'packages/vouchington-tooling/scripts/gha')
    mkdirSync(actionPath, { recursive: true })
    mkdirSync(helper, { recursive: true })
    writeFileSync(
      join(helper, 'install-github-release.sh'),
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `echo "$*" > ${JSON.stringify(join(root, 'args.txt'))}`,
        'bin_dir=""',
        'while [ "$#" -gt 0 ]; do',
        '  case "$1" in',
        '    --bin-dir) bin_dir="$2"; shift 2 ;;',
        '    *) shift ;;',
        '  esac',
        'done',
        'mkdir -p "$bin_dir"',
        'printf \'#!/bin/sh\\necho opencode ci-fixture\\n\' > "$bin_dir/opencode"',
        'chmod +x "$bin_dir/opencode"',
        '',
      ].join('\n'),
    )
    chmodSync(join(helper, 'install-github-release.sh'), 0o755)
    const output = join(root, 'github-output')
    writeFileSync(output, '')
    const stubUnames = join(root, 'bin')
    mkdirSync(stubUnames)
    writeFileSync(
      join(stubUnames, 'uname'),
      '#!/bin/sh\n[ "$1" = -s ] && echo Linux && exit 0\n[ "$1" = -m ] && echo x86_64 && exit 0\necho Linux\n',
    )
    chmodSync(join(stubUnames, 'uname'), 0o755)
    try {
      const result = spawnSync('bash', [installCli], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${stubUnames}:${process.env.PATH ?? ''}`,
          GITHUB_ACTION_PATH: actionPath,
          GITHUB_OUTPUT: output,
          OPENCODE_VERSION: pinnedVersion,
          OPENCODE_HOME: join(root, 'home'),
        },
      })
      expect({ status: result.status, stderr: result.stderr }).toMatchObject({ status: 0 })
      expect(readFileSync(join(root, 'args.txt'), 'utf8')).toContain('anomalyco/opencode')
      expect(readFileSync(join(root, 'args.txt'), 'utf8')).toContain('opencode-linux-x64.tar.gz')
      expect(readFileSync(join(root, 'args.txt'), 'utf8')).toContain(
        'd910c3ed7613bb5791a328904615d41cc25b7d3a6b470e3199ab0426a995b38a',
      )
      expect(readFileSync(output, 'utf8')).toContain(
        `bin=${join(root, `home/opencode-v${pinnedVersion}/bin/opencode`)}`,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves caller OpenCode files alone when install never ran', () => {
    const root = mkdtempSync(join(tmpdir(), 'opencode-restore-skip-'))
    const workspace = join(root, 'workspace')
    mkdirSync(join(workspace, '.opencode'), { recursive: true })
    writeFileSync(join(workspace, '.opencode/user.md'), 'keep-me\n')
    writeFileSync(join(workspace, 'opencode.json'), '{"user":true}\n')
    const env = {
      ...process.env,
      GITHUB_WORKSPACE: workspace,
      RUNNER_TEMP: join(root, 'tmp'),
    }
    try {
      expect(
        spawnSync(
          'bash',
          [resolve('.github/actions/opencode-code-review/restore-review-project.sh')],
          { encoding: 'utf8', env },
        ).status,
      ).toBe(0)
      expect(readFileSync(join(workspace, '.opencode/user.md'), 'utf8')).toBe('keep-me\n')
      expect(readFileSync(join(workspace, 'opencode.json'), 'utf8')).toBe('{"user":true}\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('restores the caller OpenCode project files after installing the review-project', () => {
    const root = mkdtempSync(join(tmpdir(), 'opencode-restore-'))
    const workspace = join(root, 'workspace')
    mkdirSync(join(workspace, '.opencode'), { recursive: true })
    writeFileSync(join(workspace, '.opencode/user.md'), 'keep-me\n')
    writeFileSync(join(workspace, 'opencode.json'), '{"user":true}\n')
    writeFileSync(join(workspace, 'opencode.jsonc'), '// user\n')
    const env = {
      ...process.env,
      GITHUB_ACTION_PATH: resolve('.github/actions/opencode-code-review'),
      GITHUB_WORKSPACE: workspace,
      RUNNER_TEMP: join(root, 'tmp'),
    }
    try {
      expect(
        spawnSync(
          'bash',
          [resolve('.github/actions/opencode-code-review/install-review-project.sh')],
          {
            encoding: 'utf8',
            env,
          },
        ).status,
      ).toBe(0)
      expect(existsSync(join(workspace, '.opencode/user.md'))).toBe(false)
      expect(readFileSync(join(workspace, 'opencode.json'), 'utf8')).toContain('autoupdate')
      expect(
        spawnSync(
          'bash',
          [resolve('.github/actions/opencode-code-review/restore-review-project.sh')],
          {
            encoding: 'utf8',
            env,
          },
        ).status,
      ).toBe(0)
      expect(readFileSync(join(workspace, '.opencode/user.md'), 'utf8')).toBe('keep-me\n')
      expect(readFileSync(join(workspace, 'opencode.json'), 'utf8')).toBe('{"user":true}\n')
      expect(readFileSync(join(workspace, 'opencode.jsonc'), 'utf8')).toBe('// user\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
