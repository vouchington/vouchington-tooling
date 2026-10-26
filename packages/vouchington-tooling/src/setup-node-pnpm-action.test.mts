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
    expect(Object.keys(action.inputs)).toEqual(['install-scripts', 'node-version-file'])
    expect(action.inputs['install-scripts']?.default).toBe('true')
    expect(action.inputs['node-version-file']?.default).toBe('.nvmrc')
    expect(source).not.toMatch(/vouchington|voucha/iu)
  })

  it('activates Node from the input version file and then pnpm 12', () => {
    const [node, resolve, pnpm] = steps
    expect(node?.uses).toMatch(/^actions\/setup-node@[0-9a-f]{40}$/)
    expect(node?.with).toEqual({
      'node-version-file': '${{ inputs.node-version-file }}',
      'package-manager-cache': false,
    })
    expect(pnpm?.uses).toMatch(/^pnpm\/setup@[0-9a-f]{40}$/)
    expect(resolve?.id).toBe('pnpm-version')
    expect(resolve?.run).toBe('node "$GITHUB_ACTION_PATH/../resolve-pnpm-version/resolve.mjs"')
    expect(pnpm?.with).toEqual({
      version: '${{ steps.pnpm-version.outputs.version }}',
      install: false,
      'node-version-file': false,
    })
  })

  it('sets pnpm up once, with no retry', () => {
    expect(
      steps.filter((candidate) => (candidate.uses ?? '').startsWith('pnpm/setup@')),
    ).toHaveLength(1)
    expect(steps.some((candidate) => 'continue-on-error' in candidate)).toBe(false)
    expect(source).not.toMatch(/action-setup|outcome/u)
  })

  it('never caches the pnpm store', () => {
    expect(steps.some((candidate) => (candidate.uses ?? '').startsWith('actions/cache'))).toBe(
      false,
    )
    expect(steps.some((candidate) => (candidate.run ?? '').includes('pnpm store path'))).toBe(false)
  })

  it('runs exactly one frozen full install per input value', () => {
    expect(step('pnpm install')).toEqual({
      name: 'pnpm install',
      if: "inputs.install-scripts != 'false'",
      shell: 'bash',
      run: 'pnpm install --frozen-lockfile --loglevel=warn',
    })
    expect(step('pnpm install without lifecycle scripts')).toEqual({
      name: 'pnpm install without lifecycle scripts',
      if: "inputs.install-scripts == 'false'",
      shell: 'bash',
      run: 'pnpm install --frozen-lockfile --ignore-scripts --loglevel=warn',
    })
  })
})
