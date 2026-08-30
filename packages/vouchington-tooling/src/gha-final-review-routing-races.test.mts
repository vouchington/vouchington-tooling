import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const head = 'a'.repeat(40)
const base = 'b'.repeat(40)
const pr = JSON.stringify({
  state: 'open',
  draft: false,
  head: { sha: head, ref: 'topic', repo: { full_name: 'owner/repo' } },
  base: { sha: base, ref: 'main', repo: { full_name: 'owner/repo' } },
})

function requestEnv(): Record<string, string> {
  return {
    READ_TOKEN: 'read',
    WRITE_TOKEN: 'write',
    SOURCE_RUN_ID: '99',
    SOURCE_RUN_ATTEMPT: '1',
    TESTED_HEAD_SHA: head,
    SOURCE_HEAD_REPOSITORY: 'owner/repo',
    DEFAULT_BRANCH: 'main',
    SOURCE_WORKFLOW_PATH: '.github/workflows/ci.yml',
    SOURCE_WORKFLOW_EVENT: 'pull_request',
    PR_NUMBER: '7',
    FAN_IN_JOB: 'tests',
    FORBIDDEN_SUCCESS_JOB: '',
    REQUESTED_LABEL: 'final-code-review:requested',
    COMPLETE_LABEL: 'final-code-review:complete',
    REVIEW_WORKFLOW_PATH: '.github/workflows/final-code-review.yml',
    REVIEW_WORKFLOW_EVENT: 'repository_dispatch',
    REVIEW_CHECK_NAME: 'Code Reviewed',
    DISPATCH_EVENT_TYPE: 'final-review-requested',
    RETRY_ATTEMPTS: '3',
    RETRY_BACKOFF_SECONDS: '0',
  }
}

async function runWithMockGh(mock: string, env: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'final-review-routing-race-'))
  const output = join(directory, 'output')
  const calls = join(directory, 'calls')
  const gh = join(directory, 'gh')
  await writeFile(
    gh,
    `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' "$*" >> "$RUNNER_TEMP/calls"\n${mock}`,
  )
  await chmod(gh, 0o755)
  try {
    await execFileAsync('bash', ['.github/actions/request-final-review/request-final-review.sh'], {
      env: {
        ...process.env,
        ...env,
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: 'owner/repo',
        PATH: `${directory}:${process.env['PATH'] ?? ''}`,
        RUNNER_TEMP: directory,
      },
    })
    return { output: await readFile(output, 'utf8'), calls: await readFile(calls, 'utf8') }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('final-review routing races', () => {
  it('resolves a retargeted pull request before applying default-branch eligibility', async () => {
    const nonDefault = pr.replace('"ref":"main"', '"ref":"release"')
    const mock = `case "$*" in
  *"actions/runs/99"*) printf '%s\\n' '{"path":".github/workflows/ci.yml","event":"pull_request","head_sha":"${head}","head_repository":{"full_name":"owner/repo"},"status":"completed","run_attempt":1,"pull_requests":[{"number":7,"base":{"sha":"${base}"}}]}' ;;
  *"pulls/7"*) printf '%s\\n' '${nonDefault}' ;;
  *"--method DELETE"*"/labels/final-code-review%3A"*) : ;;
  *) exit 64 ;;
esac`
    const { output, calls } = await runWithMockGh(mock, { ...requestEnv(), PR_NUMBER: '' })
    expect(output).toContain('decision=ineligible')
    expect(calls).not.toContain(`commits/${head}/pulls`)
    expect(calls).not.toContain('/dispatches')
  })

  it('rechecks the default-branch ref immediately before dispatch', async () => {
    const nonDefault = pr.replace('"ref":"main"', '"ref":"release"')
    const mock = `case "$*" in
  *"actions/runs/99/jobs"*) printf '%s\\n' '[{"jobs":[{"id":1,"run_attempt":1,"name":"tests","conclusion":"success"}]}]' ;;
  *"actions/runs/99"*) printf '%s\\n' '{"path":".github/workflows/ci.yml","event":"pull_request","head_sha":"${head}","head_repository":{"full_name":"owner/repo"},"status":"completed","run_attempt":1,"pull_requests":[{"number":7,"base":{"sha":"${base}"}}]}' ;;
  *"pulls/7"*) count="$(grep -c 'pulls/7$' "$RUNNER_TEMP/calls")"; [ "$count" -eq 1 ] && printf '%s\\n' '${pr}' || printf '%s\\n' '${nonDefault}' ;;
  *"commits/${head}/check-runs"*) printf '%s\\n' '[{"check_runs":[]}]' ;;
  *"--method DELETE"*"/labels/final-code-review%3A"*) : ;;
  *) exit 64 ;;
esac`
    const { output, calls } = await runWithMockGh(mock, requestEnv())
    expect(output).toContain('decision=ineligible')
    expect(calls).not.toContain('/dispatches')
  })

  it('does not clear lifecycle labels after a PR retargets back to the default branch', async () => {
    const nonDefault = pr.replace('"ref":"main"', '"ref":"release"')
    const mock = `case "$*" in
  *"actions/runs/99/jobs"*) printf '%s\\n' '[{"jobs":[{"id":1,"run_attempt":1,"name":"tests","conclusion":"success"}]}]' ;;
  *"actions/runs/99"*) printf '%s\\n' '{"path":".github/workflows/ci.yml","event":"pull_request","head_sha":"${head}","head_repository":{"full_name":"owner/repo"},"status":"completed","run_attempt":1,"pull_requests":[{"number":7,"base":{"sha":"${base}"}}]}' ;;
  *"pulls/7"*) count="$(grep -c 'pulls/7$' "$RUNNER_TEMP/calls")"; [ "$count" -eq 1 ] && printf '%s\\n' '${nonDefault}' || printf '%s\\n' '${pr}' ;;
  *"commits/${head}/check-runs"*) printf '%s\\n' '[{"check_runs":[]}]' ;;
  *"--method DELETE"*"/labels/final-code-review%3A"*) : ;;
  *"--method POST"*"/labels"*) : ;;
  *"--method POST"*"/dispatches"*) : ;;
  *) exit 64 ;;
esac`
    const { output, calls } = await runWithMockGh(mock, requestEnv())
    expect(output).toContain('decision=requested')
    expect(calls).toContain('/dispatches')
  })
})
