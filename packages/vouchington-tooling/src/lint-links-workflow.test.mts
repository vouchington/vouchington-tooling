import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

interface Step {
  name?: string
  run?: string
  if?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const source = readFileSync(join(root, '.github/workflows/lint-links.yml'), 'utf8')
const workflow = load(source) as {
  on: { workflow_call: { inputs: Record<string, { default?: string }> } }
  jobs: { 'lint-links': { steps: Step[] } }
}
const steps = workflow.jobs['lint-links'].steps

function step(name: string) {
  const found = steps.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`missing step ${name}`)
  return found
}

describe('lint-links reusable workflow', () => {
  it('takes the lychee config, version, and optional exclusion probe', () => {
    expect(workflow.on.workflow_call.inputs.config?.default).toBe('lychee.toml')
    expect(workflow.on.workflow_call.inputs['lychee-version']?.default).toBe('0.24.2')
    expect(workflow.on.workflow_call.inputs['excluded-urls']?.default).toBe('')
    expect(workflow.on.workflow_call.inputs['checked-urls']?.default).toBe('')
    expect(source).not.toContain('schedule:')
    expect(source).not.toMatch(/voucha|filament|storybook|vouchington-machines|openai/iu)
    expect(step('Install lychee').env?.LYCHEE_VERSION).toBe('${{ inputs.lychee-version }}')
    expect(step('Install lychee').run).toContain('--repo lycheeverse/lychee')
    expect(step('Verify link exclusions').if).toBe(
      "${{ inputs.excluded-urls != '' || inputs.checked-urls != '' }}",
    )
    expect(step('Check links').env?.GITHUB_TOKEN).toBe('${{ github.token }}')
    expect(step('Check links').run).toContain('scripts/gha/lint-links.sh')
  })

  it('compares the lychee dump with the URLs that must still be checked', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lint-links-probe-'))
    const bin = join(directory, 'bin')
    mkdirSync(bin)
    writeFileSync(
      join(bin, 'lychee'),
      `#!/bin/bash
while IFS= read -r line; do
  case "$line" in
    *excluded*) ;;
    *) printf '%s\\n' "$line" ;;
  esac
done
`,
    )
    chmodSync(join(bin, 'lychee'), 0o755)
    try {
      const result = spawnSync(
        'bash',
        [
          '--noprofile',
          '--norc',
          '-eo',
          'pipefail',
          '-c',
          step('Verify link exclusions').run ?? '',
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH ?? ''}`,
            LYCHEE_CONFIG: 'lychee.toml',
            EXCLUDED_URLS: 'https://example.com/excluded',
            CHECKED_URLS: 'https://example.com/kept',
          },
        },
      )
      expect(result.status).toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('checks out the tooling repository at the called workflow sha', () => {
    expect(source).not.toContain('workflow_ref')
    expect(step('Checkout tooling scripts').with).toMatchObject({
      repository: '${{ job.workflow_repository }}',
      ref: '${{ job.workflow_sha }}',
      'persist-credentials': false,
    })
    expect(steps[0]?.with?.['persist-credentials']).toBe(false)
  })

  describe('lychee version guard', () => {
    function install(version: string) {
      const directory = mkdtempSync(join(tmpdir(), 'lint-links-install-'))
      const script = join(
        directory,
        '.vouchington-tooling-checkout/packages/vouchington-tooling/scripts/gha',
      )
      mkdirSync(script, { recursive: true })
      writeFileSync(join(script, 'install-github-release.sh'), 'echo "installer $*"\n')
      try {
        const result = spawnSync(
          'bash',
          ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step('Install lychee').run ?? ''],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              LYCHEE_VERSION: version,
              GITHUB_WORKSPACE: directory,
              GITHUB_PATH: join(directory, 'path'),
              RUNNER_TEMP: directory,
            },
          },
        )
        return { status: result.status, out: result.stdout }
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }

    it.each(['0.23.0', '0.9.1', '0.24', 'latest', '0.24.x'])('rejects %s', (version) => {
      const result = install(version)
      expect(result.status).toBe(2)
      expect(result.out).toContain('::error::')
      expect(result.out).not.toContain('installer')
    })

    it('accepts 0.24.1 and later with the default asset name', () => {
      for (const version of ['0.24.1', '0.25.0', '1.0.0']) {
        const result = install(version)
        expect(result.status).toBe(0)
        expect(result.out).toContain('--asset lychee-{platform}.tar.gz')
      }
    })

    it('uses the prefixed asset name for 0.24.0', () => {
      const result = install('0.24.0')
      expect(result.status).toBe(0)
      expect(result.out).toContain('--asset lychee-lychee-v{version}-{platform}.tar.gz')
    })
  })
})
