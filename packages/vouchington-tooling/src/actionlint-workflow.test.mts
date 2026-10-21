import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

interface Step {
  name?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
  env?: Record<string, string>
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const source = readFileSync(join(root, '.github/workflows/actionlint.yml'), 'utf8')
const workflow = load(source) as {
  on: { workflow_call: { inputs: Record<string, { default?: string }> } }
  permissions: Record<string, string>
  jobs: { actionlint: { steps: Step[] } }
}

function step(name: string) {
  const found = workflow.jobs.actionlint.steps.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`missing step ${name}`)
  return found
}

describe('actionlint reusable workflow', () => {
  it('is a workflow_call with zizmor thresholds and no missing actionlint config paths', () => {
    expect(workflow.on.workflow_call.inputs['min-severity']?.default).toBe('high')
    expect(workflow.on.workflow_call.inputs['min-confidence']?.default).toBe('high')
    expect(workflow.on.workflow_call.inputs['runs-on']?.default).toBe('ubuntu-slim')
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(source).not.toContain('.github/actionlint.yaml')
    expect(source).not.toContain('.github/actionlint.yml')
    expect(source).not.toMatch(/voucha|filament|storybook|vouchington-machines/iu)
  })

  it('installs tools from the caller mise.toml with the cache disabled', () => {
    const install = step('Install CI tools via mise')
    expect(install.uses).toBe('jdx/mise-action@2d8d4cafcbd33be2ea37d2b6f5ad595363d1f1ca')
    expect(install.with).toEqual({ cache: false })
    expect(step('Run actionlint').run).toBe('actionlint')
    expect(source).not.toContain('-ignore')
  })

  it('rejects a non-token zizmor severity before launching zizmor', () => {
    const result = spawnSync(
      'bash',
      [
        '--noprofile',
        '--norc',
        '-eo',
        'pipefail',
        '-c',
        step('Audit GitHub Actions security').run ?? '',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, ZIZMOR_MIN_SEVERITY: 'high;rm', ZIZMOR_MIN_CONFIDENCE: 'high' },
      },
    )
    expect(result.status).toBe(2)
    expect(result.stdout).toContain('min-severity must be a single token')
  })
})
