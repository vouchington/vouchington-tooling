import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Step = {
  id?: string
  name?: string
  run?: string
  uses?: string
  if?: string
  shell?: string
  with?: Record<string, unknown>
}

const path = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  '.github/actions/setup-node-pnpm/action.yml',
)
const source = readFileSync(path, 'utf8')
const action = load(source) as {
  inputs: Record<string, { default?: string; required?: boolean }>
  runs: { using: string; steps: Step[] }
}
const steps = action.runs.steps

function step(name: string) {
  const found = steps.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`Missing setup-node-pnpm step: ${name}`)
  return found
}

describe('setup-node-pnpm composite action', () => {
  it('is a composite action with optional install-scripts and node-version-file inputs', () => {
    expect(action.runs.using).toBe('composite')
    expect(Object.keys(action.inputs)).toEqual([
      'deadline-seconds',
      'install-scripts',
      'node-version-file',
      'install-attempt-timeout-seconds',
      'install-attempts',
    ])
    expect(action.inputs['install-attempt-timeout-seconds']?.default).toBe('150')
    expect(action.inputs['install-attempts']?.default).toBe('2')
    expect(action.inputs['deadline-seconds']?.default).toBe('270')
    expect(action.inputs['install-scripts']?.default).toBe('true')
    expect(action.inputs['node-version-file']?.default).toBe('.nvmrc')
    expect(source).not.toMatch(/vouchington|voucha/iu)
  })

  it('records the deadline start first, then activates Node and downloads pnpm 12', () => {
    const [start, node, resolve, download] = steps
    expect(start?.run).toBe('echo "SETUP_NODE_PNPM_STARTED_MS=$(date +%s)000" >> "$GITHUB_ENV"')
    expect(node?.uses).toMatch(/^actions\/setup-node@[0-9a-f]{40}$/)
    expect(node?.with).toEqual({
      'node-version-file': '${{ inputs.node-version-file }}',
      'package-manager-cache': false,
    })
    expect(resolve?.id).toBe('pnpm-version')
    expect(resolve?.run).toBe('node "$GITHUB_ACTION_PATH/../resolve-pnpm-version/resolve.mjs"')
    expect(download).toEqual({
      name: 'Download pnpm',
      shell: 'bash',
      env: {
        PNPM_VERSION: '${{ steps.pnpm-version.outputs.version }}',
        SETUP_NODE_PNPM_DEADLINE_SECONDS: '${{ inputs.deadline-seconds }}',
      },
      run: 'node "$GITHUB_ACTION_PATH/download-pnpm.mjs"',
    })
  })

  it('downloads pnpm through its own bounded script, with no pnpm/setup and no retry', () => {
    expect(steps.some((candidate) => (candidate.uses ?? '').startsWith('pnpm/setup@'))).toBe(false)
    expect(steps.some((candidate) => 'continue-on-error' in candidate)).toBe(false)
    expect(steps.some((candidate) => 'timeout-minutes' in candidate)).toBe(false)
    expect(source).not.toMatch(/action-setup|outcome/u)
  })

  it('never caches the pnpm store', () => {
    expect(steps.some((candidate) => (candidate.uses ?? '').startsWith('actions/cache'))).toBe(
      false,
    )
    expect(steps.some((candidate) => (candidate.run ?? '').includes('pnpm store path'))).toBe(false)
  })

  it('runs exactly one frozen full install per input value', () => {
    const env = {
      INSTALL_ATTEMPT_TIMEOUT_SECONDS: '${{ inputs.install-attempt-timeout-seconds }}',
      INSTALL_ATTEMPTS: '${{ inputs.install-attempts }}',
      SETUP_NODE_PNPM_DEADLINE_SECONDS: '${{ inputs.deadline-seconds }}',
    }
    const run = 'node "$GITHUB_ACTION_PATH/install.mjs"'
    expect(step('pnpm install')).toEqual({
      name: 'pnpm install',
      if: "inputs.install-scripts != 'false'",
      shell: 'bash',
      env,
      run,
    })
    expect(step('pnpm install without lifecycle scripts')).toEqual({
      name: 'pnpm install without lifecycle scripts',
      if: "inputs.install-scripts == 'false'",
      shell: 'bash',
      env: { ...env, INSTALL_IGNORE_SCRIPTS: 'true' },
      run,
    })
  })
})
