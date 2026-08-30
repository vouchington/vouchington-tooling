import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const gateScript = resolve('.github/actions/final-review-gate/gate.sh')
const requireScript = resolve('.github/actions/final-review-gate/require.sh')
const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const BASE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function run(script: string, env: Record<string, string>) {
  return spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, ...env } })
}

function runGate(overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'final-review-gate-'))
  const gh = join(directory, 'gh')
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
printf '{"head":{"sha":"%s"},"base":{"sha":"%s","ref":"main","repo":{"full_name":"owner/repo"}},"draft":%s,"state":"open"}\\n' "\${LIVE_HEAD_SHA:-$SELECTED_HEAD_SHA}" "\${LIVE_BASE_SHA:-$SELECTED_BASE_SHA}" "\${LIVE_DRAFT:-false}"
`,
  )
  chmodSync(gh, 0o755)
  try {
    return run(gateScript, {
      PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
      SELECT_RESULT: 'success',
      SETTINGS_RESULT: 'success',
      IS_DRAFT: 'false',
      EVENT_BASE_REF: 'main',
      EVENT_STATE: 'open',
      DEFAULT_BRANCH: 'main',
      GATE_STATUS: 'review',
      GITHUB_REPOSITORY: 'owner/repo',
      GH_TOKEN: 'github-actions-token',
      GH_RETRY_ATTEMPTS: '3',
      GH_RETRY_BACKOFF_SECONDS: '0',
      GH_RETRY_TRANSPORT_MARKERS: 'unexpected EOF',
      PR_NUMBER: '1',
      SELECTED_HEAD_SHA: HEAD,
      SELECTED_BASE_SHA: BASE,
      PROVIDER_RESULTS_JSON: '[]',
      ...overrides,
    })
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

describe('advisory-provider fan-in', () => {
  it('accepts an explicit empty provider list', () => {
    const result = runGate()
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('::warning::')
  })

  it('warns when a named provider fails instead of failing the native gate', () => {
    const result = runGate({
      PROVIDER_RESULTS_JSON: '[{"name":"Review platform","outcome":"failure"}]',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      '::warning::Review platform review did not complete successfully',
    )
  })

  it.each([
    ['not JSON'],
    ['{}'],
    ['[{"name":"Review platform"}]'],
    ['[{"name":"","outcome":"success"}]'],
    ['[{"name":"Review platform","outcome":false}]'],
    ['[{"name":"Review\\nplatform","outcome":"failure"}]'],
    ['[{"name":"Review platform","outcome":"success","extra":true}]'],
  ])('fails closed for malformed provider results: %s', (providerResults) => {
    const result = runGate({ PROVIDER_RESULTS_JSON: providerResults })
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('::error::provider_results_json')
  })

  it('warns when using the deprecated legacy provider environment', () => {
    const result = runGate({
      PROVIDER_RESULTS_JSON: '',
      CLAUDE_ENABLED: 'true',
      CLAUDE_RESULT: 'failure',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('::warning::provider_results_json is required')
    expect(result.stdout).toContain('::warning::Claude review did not complete successfully')
  })

  it('passes an untrusted PR without requiring review settings', () => {
    expect(runGate({ GATE_STATUS: 'untrusted', SETTINGS_RESULT: 'skipped' }).status).toBe(0)
  })

  it('rejects completion when the live PR became a draft', () => {
    expect(runGate({ LIVE_DRAFT: 'true' }).status).not.toBe(0)
  })
})

describe('native gate require', () => {
  it('fails closed when the completion label step fails during review', () => {
    const result = run(requireScript, {
      GATE_OUTCOME: 'success',
      GATE_STATUS: 'review',
      MARK_OUTCOME: 'failure',
      CLEANUP_OUTCOME: 'success',
      REQUESTED_LABEL: 'final-code-review:requested',
    })
    expect(result.status).not.toBe(0)
  })

  it('passes when advisory validation succeeded and labels were applied', () => {
    expect(
      run(requireScript, {
        GATE_OUTCOME: 'success',
        GATE_STATUS: 'review',
        MARK_OUTCOME: 'success',
        CLEANUP_OUTCOME: 'success',
        REQUESTED_LABEL: 'final-code-review:requested',
      }).status,
    ).toBe(0)
  })
})
