import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Step = {
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
    const [node, pnpm] = steps
    expect(node?.uses).toMatch(/^actions\/setup-node@[0-9a-f]{40}$/)
    expect(node?.with).toEqual({
      'node-version-file': '${{ inputs.node-version-file }}',
      'package-manager-cache': false,
    })
    expect(pnpm?.uses).toMatch(/^pnpm\/action-setup@[0-9a-f]{40}$/)
    expect(pnpm?.with).toEqual({ version: 'latest-12' })
  })

  it('restores the pnpm store cache before installing', () => {
    const names = steps.map((candidate) => candidate.name)
    const cache = names.indexOf('Cache pnpm store')
    expect(cache).toBeGreaterThan(-1)
    expect(cache).toBeLessThan(names.indexOf('pnpm install'))
    expect(cache).toBeLessThan(names.indexOf('pnpm install without lifecycle scripts'))
    expect(step('Cache pnpm store').uses).toMatch(/^actions\/cache@[0-9a-f]{40}$/)
  })

  it('hashes the lockfile with sha256sum or shasum', () => {
    const run = step('Resolve pnpm store path').run ?? ''
    expect(run).toContain('sha256sum pnpm-lock.yaml')
    expect(run).toContain('shasum -a 256 pnpm-lock.yaml')
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
