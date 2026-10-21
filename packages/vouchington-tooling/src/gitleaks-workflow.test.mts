import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

interface Step {
  id?: string
  name?: string
  run?: string
  uses?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
  if?: string
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const source = readFileSync(join(root, '.github/workflows/gitleaks.yml'), 'utf8')
const workflow = load(source) as {
  on: { workflow_call: { inputs: Record<string, { default?: string }> } }
  jobs: { gitleaks: { steps: Step[] } }
}
const steps = workflow.jobs.gitleaks.steps

function step(name: string) {
  const found = steps.find((candidate) => candidate.name === name)
  if (!found?.run) throw new Error(`missing step ${name}`)
  return found
}

function runRange(env: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'gitleaks-range-'))
  const bin = join(directory, 'bin')
  const output = join(directory, 'output')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'git'),
    `#!/bin/bash
if [ "$1" = merge-base ]; then printf '%s\\n' merge-base-sha; exit 0; fi
echo "unexpected git $*" >&2
exit 1
`,
  )
  chmodSync(join(bin, 'git'), 0o755)
  try {
    const result = spawnSync(
      'bash',
      [
        '--noprofile',
        '--norc',
        '-eo',
        'pipefail',
        '-c',
        step('Determine Gitleaks scan range').run ?? '',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: output,
          ...env,
        },
      },
    )
    const written = result.status === 0 ? readFileSync(output, 'utf8') : ''
    return { status: result.status, stdout: result.stdout, written }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('gitleaks git reusable workflow', () => {
  it('takes a version and config and stays distinct from the directory scan', () => {
    expect(workflow.on.workflow_call.inputs.version?.default).toBe('8.30.1')
    expect(workflow.on.workflow_call.inputs.config?.default).toBe('.gitleaks.toml')
    expect(step('Scan git history').run).toContain('gitleaks git')
    expect(step('Scan git history').run).not.toContain('gitleaks dir')
    expect(source).not.toMatch(/voucha|filament|storybook|vouchington-machines/iu)
    expect(step('Install gitleaks').env?.GITLEAKS_VERSION).toBe('${{ inputs.version }}')
    expect(step('Install gitleaks').run).toContain(
      '.tooling/packages/vouchington-tooling/scripts/gha/install-github-release.sh',
    )
    expect(step('Install gitleaks').run).toContain('--repo gitleaks/gitleaks')
    expect(step('Install gitleaks').run).toContain('--bin-dir "$RUNNER_TEMP/bin"')
    expect(step('Scan git history').env?.GITLEAKS_CONFIG).toBe('${{ inputs.config }}')
    const upload = steps.find((candidate) => candidate.name === 'Upload redacted gitleaks report')
    expect(upload?.if).toBe('${{ failure() }}')
    expect(upload?.uses).toBe('actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9')
  })

  it('checks out the tooling repository at the called workflow sha', () => {
    expect(source).not.toContain('workflow_ref')
    const tooling = steps.find((candidate) => candidate.name === 'Checkout tooling scripts')
    expect(tooling?.with).toMatchObject({
      repository: 'vouchington/vouchington-tooling',
      ref: '${{ job.workflow_sha }}',
      'persist-credentials': false,
    })
    expect(steps[0]?.with?.['persist-credentials']).toBe(false)
  })

  it('scans the pull request merge base, the merge group range, or all history', () => {
    expect(
      runRange({
        EVENT_NAME: 'pull_request',
        PR_BASE_SHA: 'base',
        PR_HEAD_SHA: 'head',
        MERGE_GROUP_BASE_SHA: '',
        MERGE_GROUP_HEAD_SHA: '',
      }).written,
    ).toBe('log-opts=merge-base-sha..head\n')
    expect(
      runRange({
        EVENT_NAME: 'merge_group',
        PR_BASE_SHA: '',
        PR_HEAD_SHA: '',
        MERGE_GROUP_BASE_SHA: 'queue-base',
        MERGE_GROUP_HEAD_SHA: 'queue-head',
      }).written,
    ).toBe('log-opts=queue-base..queue-head\n')
    expect(
      runRange({
        EVENT_NAME: 'workflow_dispatch',
        PR_BASE_SHA: '',
        PR_HEAD_SHA: '',
        MERGE_GROUP_BASE_SHA: '',
        MERGE_GROUP_HEAD_SHA: '',
      }).written,
    ).toBe('log-opts=--all\n')
    expect(
      runRange({
        EVENT_NAME: 'push',
        PR_BASE_SHA: '',
        PR_HEAD_SHA: '',
        MERGE_GROUP_BASE_SHA: '',
        MERGE_GROUP_HEAD_SHA: '',
      }).status,
    ).toBe(1)
  })
})
