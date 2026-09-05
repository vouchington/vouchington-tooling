import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

const actionPath = '.github/actions/ci-required-result-gate/action.yml'
const scriptPath = resolve('.github/actions/ci-required-result-gate/check-results.sh')

describe('CI required-result gate action', () => {
  it('stays dependency-free and resolves its script through GITHUB_ACTION_PATH', () => {
    const action = load(readFileSync(actionPath, 'utf8')) as {
      runs?: { steps?: Array<{ run?: string; uses?: string }> }
    }
    const source = `${readFileSync(actionPath, 'utf8')}\n${readFileSync(scriptPath, 'utf8')}`

    expect(action.runs?.steps).toHaveLength(1)
    expect(action.runs?.steps?.at(0)?.run).toBe('bash "$GITHUB_ACTION_PATH/check-results.sh"')
    expect(action.runs?.steps?.at(0)?.uses).toBeUndefined()
    expect(source).not.toContain('node_modules')
  })

  it('passes successful compact results from an empty working directory', () => {
    expect(() =>
      execFileSync('bash', [scriptPath], {
        cwd: '/',
        env: { MODE: 'required', RESULTS: '{"tests-processing":{"result":"success"}}' },
      }),
    ).not.toThrow()
  })

  it('accepts skipped results and rejects failures and cancellations in every mode', () => {
    for (const mode of ['required', 'build']) {
      const accepted = spawnSync('bash', [scriptPath], {
        encoding: 'utf8',
        env: { MODE: mode, RESULTS: '{"dependency":{"result":"skipped"}}' },
      })
      expect(accepted.status).toBe(0)
      expect(accepted.stdout).toContain(
        mode === 'build'
          ? 'All build jobs passed or were skipped'
          : 'All required jobs passed or were skipped',
      )
      for (const value of ['failure', 'cancelled', 'timed_out', 'unknown']) {
        const rejected = spawnSync('bash', [scriptPath], {
          encoding: 'utf8',
          env: { MODE: mode, RESULTS: `{"dependency":{"result":"${value}"}}` },
        })
        expect(rejected.status).toBe(1)
        expect(rejected.stderr).toContain('::error::One or more')
      }
    }
  })

  it('fails malformed compact result shapes and unsupported modes', () => {
    for (const results of [
      '{}',
      '[]',
      '{"dependency":{}}',
      '{"dependency":{"result":"success","extra":true}}',
    ]) {
      expect(spawnSync('bash', [scriptPath], { env: { RESULTS: results } }).status).toBe(1)
    }
    expect(
      spawnSync('bash', [scriptPath], {
        env: { MODE: 'invalid', RESULTS: '{"dependency":{"result":"success"}}' },
      }).status,
    ).toBe(2)
  })

  it('documents a package-version pin comment, not an action-local v1.0.0', () => {
    const readme = readFileSync('README.md', 'utf8')
    const example = readme
      .split('\n')
      .find((line) => line.includes('ci-required-result-gate@') && line.includes('# v'))

    expect(example).toMatch(/ci-required-result-gate@<40-character-commit-sha> # vX\.Y\.Z$/)
    expect(readme).not.toMatch(/ci-required-result-gate@[^\n]*# v1\.0\.0/)
    expect(readme).toContain('vouchington-tooling/vX.Y.Z')
  })
})
