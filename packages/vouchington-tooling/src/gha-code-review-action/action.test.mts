import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type CompositeStep = {
  name?: string
  id?: string
  if?: string
  env?: Record<string, string>
  run?: string
  uses?: string
  with?: Record<string, unknown>
  'continue-on-error'?: boolean
}

type CompositeAction = {
  inputs?: Record<string, { default?: string }>
  outputs?: Record<string, { value?: string }>
  runs?: { using?: string; steps?: CompositeStep[] }
}

const actionText = readFileSync('.github/actions/code-review/action.yml', 'utf8')
const action = load(actionText) as CompositeAction
const steps = action.runs?.steps ?? []
const stepByName = new Map(steps.map((step) => [step.name, step]))

describe('code-review action', () => {
  it('does not accept a prompt input and always supplies a constructed prompt', () => {
    expect(action.inputs).not.toHaveProperty('prompt')
    expect(actionText).not.toContain('issue_comment')
    expect(actionText).not.toContain('@claude')
    expect(actionText).toContain('prompt: ${{ steps.review-prompt.outputs.prompt }}')
    expect(actionText).toContain('--disallowedTools Bash')
  })

  it('rejects extra_prompt unless the calling repository is private', () => {
    const build = stepByName.get('Build review prompt')
    expect(build?.env?.EXTRA_PROMPT).toBe('${{ inputs.extra_prompt }}')
    expect(build?.env?.REPO_PRIVATE).toBe('${{ github.event.repository.private }}')
    expect(build?.run).toContain('extra_prompt is only allowed in private repositories')
    expect(build?.run).toContain('validate-prompt-path.sh')
  })

  it('allowlists model and effort values', () => {
    const build = stepByName.get('Build review prompt')
    expect(build?.run).toContain('haiku|sonnet|opus')
    expect(build?.run).toContain('low|medium|high|xhigh|max')
  })

  it('checks out the trusted prompt into runner temp and uses OS tmpdir worktrees', () => {
    const checkout = stepByName.get('Checkout trusted review prompt')
    expect(checkout?.with?.path).toBe('.trusted-review-prompt')
    const home = stepByName.get('Isolate Claude Code install home')
    expect(home?.run).toContain('worktree-create.sh')
    expect(home?.run).toContain('VOUCHINGTON_ACTION_PATH')
    expect(home?.run).toContain('\\"baseRef\\":\\"head\\"')
    const worktree = readFileSync('.github/actions/code-review/worktree-create.sh', 'utf8')
    expect(worktree).toContain('mktemp -d "${TMPDIR:-/tmp}/code-review-wt.XXXXXX"')
    expect(worktree).not.toContain('/tmp/code-review-wt')
    expect(stepByName.get('Stage trusted action runtime')?.run).toContain('stage-runtime.sh')
    expect(stepByName.get('Clear leftover review payload')?.run).toContain('.vouchington-tooling')
    expect(stepByName.get('Clean review payload files')?.run).toContain('cleanup-worktrees.sh')
    expect(actionText).not.toMatch(/cp "\$GITHUB_ACTION_PATH\/worktree-create\.sh"/)
  })

  it('stages the payload through the same-ref CLI', () => {
    const stage = stepByName.get('Stage review payload artifact')
    expect(stage?.run).toContain('VOUCHINGTON_TOOLING_ROOT')
    expect(stage?.run).toContain('gha-review-payload/cli.mts')
    expect(stage?.run).toContain(' optional ')
    expect(actionText).not.toContain('install-vouchington-tooling.sh')
  })

  it('resolves a numeric Node version from the action repository', () => {
    const resolver = stepByName.get('Resolve trusted Node version')
    expect(resolver?.run).toContain('resolve-node-version.sh')
    const root = mkdtempSync(join(tmpdir(), 'code-review-node-'))
    const actionPath = join(root, '.github', 'actions', 'code-review')
    mkdirSync(actionPath, { recursive: true })
    writeFileSync(join(root, '.nvmrc'), '24\n')
    const outputPath = join(root, 'github-output')
    writeFileSync(outputPath, '')
    const script = resolve('.github/actions/code-review/resolve-node-version.sh')
    try {
      const result = spawnSync('bash', [script], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_ACTION_PATH: actionPath, GITHUB_OUTPUT: outputPath },
      })
      expect(result.status).toBe(0)
      expect(readFileSync(outputPath, 'utf8')).toBe('version=24\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a missing or non-numeric trusted Node version', () => {
    const root = mkdtempSync(join(tmpdir(), 'code-review-node-bad-'))
    const actionPath = join(root, '.github', 'actions', 'code-review')
    mkdirSync(actionPath, { recursive: true })
    const outputPath = join(root, 'github-output')
    writeFileSync(outputPath, '')
    const script = resolve('.github/actions/code-review/resolve-node-version.sh')
    try {
      const missing = spawnSync('bash', [script], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_ACTION_PATH: actionPath, GITHUB_OUTPUT: outputPath },
      })
      expect(missing.status).not.toBe(0)
      writeFileSync(join(root, '.nvmrc'), 'lts/*\n')
      const invalid = spawnSync('bash', [script], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_ACTION_PATH: actionPath, GITHUB_OUTPUT: outputPath },
      })
      expect(invalid.status).not.toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('validate-prompt-path', () => {
  const script = '.github/actions/code-review/validate-prompt-path.sh'

  it('accepts default relative paths and rejects traversal', () => {
    const ok = spawnSync('bash', [script, '.agents/skills/agent-workflow/code-review-prompt.md'], {
      encoding: 'utf8',
    })
    expect(ok.status).toBe(0)
    expect(ok.stdout).toBe('.agents/skills/agent-workflow/code-review-prompt.md\n')
    for (const path of ['/etc/passwd', '../secret', 'foo/../../etc/passwd', '', 'a\nb']) {
      const result = spawnSync('bash', [script, path], { encoding: 'utf8' })
      expect(result.status).not.toBe(0)
    }
  })
})
