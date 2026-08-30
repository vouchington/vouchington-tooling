import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { readFileSync as readFileSyncNode } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Action = {
  inputs?: Record<string, { default?: string; required?: boolean }>
  outputs?: Record<string, { value?: string }>
  runs?: { steps?: Array<{ env?: Record<string, string>; run?: string }> }
}

function action(path: string): Action {
  return load(readFileSyncNode(path, 'utf8')) as Action
}

const execFileAsync = promisify(execFile)
const head = 'a'.repeat(40)
const base = 'b'.repeat(40)
const pr = JSON.stringify({
  state: 'open',
  draft: false,
  user: { login: 'author' },
  head: { sha: head, ref: 'topic', repo: { full_name: 'owner/repo' } },
  base: { sha: base, ref: 'main', repo: { full_name: 'owner/repo' } },
})

async function runWithMockGh(script: string, mock: string, env: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'final-review-action-'))
  const output = join(directory, 'output')
  const gh = join(directory, 'gh')
  await writeFile(gh, `#!/usr/bin/env bash\nset -euo pipefail\necho mock-warning >&2\n${mock}`)
  await chmod(gh, 0o755)
  try {
    await execFileAsync('bash', [script], {
      env: {
        ...process.env,
        ...env,
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: 'owner/repo',
        PATH: `${directory}:${process.env['PATH'] ?? ''}`,
        RUNNER_TEMP: directory,
      },
    })
    return await readFile(output, 'utf8')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('event-driven final-review actions', () => {
  const root = '.github/actions'

  it('selects one completed validation snapshot without polling', () => {
    const select = action(`${root}/select-final-review/action.yml`)
    expect(select.inputs).toMatchObject({
      'read-token': { required: true },
      'request-event-type': { default: 'final-review-requested' },
      'source-run-id': { default: '' },
      'source-run-attempt': { default: '' },
      'source-base-sha': { default: '' },
      'workflow-path': { required: true },
      'fan-in-job': { required: true },
      'forbidden-success-job': { default: '' },
      'retry-attempts': { default: '3' },
    })
    expect(select.inputs).not.toHaveProperty('poll-attempts')
    expect(select.inputs).not.toHaveProperty('poll-seconds')
    expect(Object.keys(select.outputs ?? {})).toEqual([
      'should_review',
      'gate_status',
      'pr_number',
      'head_sha',
      'base_sha',
    ])

    const script = readFileSyncNode(`${root}/select-final-review/select-final-review.sh`, 'utf8')
    expect(script).toContain('.status == "completed"')
    expect(script).toContain('.run_attempt == $attempt')
    expect(script).toContain('.base.sha == $base')
    expect(script).toContain('repository_dispatch')
    expect(script).toContain('--paginate --slurp')
    expect(script).not.toContain('2>&1')
    expect(script).not.toContain('POLL_')
    expect(script).not.toMatch(/for attempt in.*seq/)
  })

  it('routes one exact completed source run with separate mutation credentials', () => {
    const request = action(`${root}/request-final-review/action.yml`)
    expect(request.inputs).toMatchObject({
      'read-token': { required: true },
      'write-token': { required: true },
      'source-run-id': { required: true },
      'source-workflow-path': { required: true },
      'fan-in-job': { required: true },
      'review-workflow-path': { required: true },
      'review-check-name': { required: true },
      'review-workflow-event': { default: 'repository_dispatch' },
      'dispatch-event-type': { default: 'final-review-requested' },
      'retry-attempts': { default: '3' },
    })
    expect(request.runs?.steps?.[0]?.env).toMatchObject({
      READ_TOKEN: '${{ inputs.read-token }}',
      WRITE_TOKEN: '${{ inputs.write-token }}',
    })

    const script = readFileSyncNode(`${root}/request-final-review/request-final-review.sh`, 'utf8')
    expect(script).toContain('GH_TOKEN="$WRITE_TOKEN" gh_retry')
    expect(script).toContain(
      'Source workflow identity, event, head, or completion state did not match.',
    )
    expect(script).toContain('.head_repository.full_name == $head_repo')
    expect(script).toContain('Could not resolve exactly one open pull request')
    expect(script).toContain('check-runs')
    expect(script).toContain('client_payload[source_run_id]')
    expect(script).toContain('--paginate --slurp')
    expect(script).not.toContain('2>&1')
  })

  it('executes selection with stderr-safe paginated snapshots', async () => {
    const mock = `
case "$*" in
  *"pulls/7"*) printf '%s\\n' '${pr}' ;;
  *"actions/runs/99/jobs"*) printf '%s\\n' '[{"jobs":[{"id":1,"run_attempt":2,"name":"tests","conclusion":"success"}]}]' ;;
  *"actions/runs/99"*) printf '%s\\n' '{"id":99,"run_attempt":2,"path":".github/workflows/ci.yml","head_sha":"${head}","event":"pull_request","status":"completed","pull_requests":[{"number":7,"base":{"sha":"${base}"}}]}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 64 ;;
esac`
    const output = await runWithMockGh(
      '.github/actions/select-final-review/select-final-review.sh',
      mock,
      {
        GH_TOKEN: 'read',
        PR_NUMBER: '7',
        EVENT_NAME: 'repository_dispatch',
        EVENT_ACTION: 'final-review-requested',
        EVENT_HEAD_SHA: head,
        REQUEST_EVENT_TYPE: 'final-review-requested',
        SOURCE_RUN_ID: '99',
        SOURCE_RUN_ATTEMPT: '2',
        SOURCE_BASE_SHA: base,
        DEFAULT_BRANCH: 'main',
        WORKFLOW_PATH: '.github/workflows/ci.yml',
        WORKFLOW_EVENT: 'pull_request',
        FAN_IN_JOB: 'tests',
        FORBIDDEN_SUCCESS_JOB: '',
        RETRY_ATTEMPTS: '3',
        RETRY_BACKOFF_SECONDS: '0',
        UNTRUSTED_ACTORS: '',
      },
    )
    expect(output).toContain('should_review=true')
    expect(output).toContain('gate_status=review')
  })

  it('executes routing and URL-encodes label mutations', async () => {
    const mock = `
case "$*" in
  *"actions/runs/99/jobs"*) printf '%s\\n' '[{"jobs":[{"id":1,"run_attempt":1,"name":"tests","conclusion":"success"}]}]' ;;
  *"actions/runs/99"*) printf '%s\\n' '{"path":".github/workflows/ci.yml","event":"pull_request","head_sha":"${head}","head_repository":{"full_name":"owner/repo"},"status":"completed","run_attempt":1,"pull_requests":[{"number":7,"base":{"sha":"${base}"}}]}' ;;
  *"pulls/7"*) printf '%s\\n' '${pr}' ;;
  *"commits/${head}/check-runs"*) printf '%s\\n' '[{"check_runs":[]}]' ;;
  *"--method DELETE"*"/labels/final-code-review%3A"*) : ;;
  *"--method POST"*"/labels"*) : ;;
  *"--method POST"*"/dispatches"*"event_type=final-review-requested"*) : ;;
  *) echo "unexpected gh call: $*" >&2; exit 64 ;;
esac`
    const output = await runWithMockGh(
      '.github/actions/request-final-review/request-final-review.sh',
      mock,
      {
        READ_TOKEN: 'read',
        WRITE_TOKEN: 'write',
        SOURCE_RUN_ID: '99',
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
      },
    )
    expect(output).toContain('requested=true')
    expect(output).toContain('decision=requested')
  })

  it('publishes the required check on the selected pull-request head', () => {
    const gate = action(`${root}/final-review-gate/action.yml`)
    expect(gate.inputs).toMatchObject({ check_name: { default: '' } })
    const publish = readFileSyncNode(`${root}/final-review-gate/publish-check.sh`, 'utf8')
    const requireGate = readFileSyncNode(`${root}/final-review-gate/require.sh`, 'utf8')
    expect(publish).toContain('repos/$GITHUB_REPOSITORY/check-runs')
    expect(publish).toContain('head_sha=$SELECTED_HEAD_SHA')
    expect(publish).toContain('GATE_STATUS')
    expect(requireGate).toContain('CHECK_CONCLUSION')
  })

  it('executes selected-head check publication after a successful gate', async () => {
    const output = await runWithMockGh(
      '.github/actions/final-review-gate/publish-check.sh',
      `case "$*" in
        *"check-runs"*"head_sha=${head}"*"conclusion=success"*) : ;;
        *) echo "unexpected gh call: $*" >&2; exit 64 ;;
      esac`,
      {
        GH_TOKEN: 'write',
        GH_RETRY_ATTEMPTS: '3',
        GH_RETRY_BACKOFF_SECONDS: '0',
        GH_RETRY_TRANSPORT_MARKERS: 'unexpected EOF',
        GATE_OUTCOME: 'success',
        GATE_STATUS: 'review',
        MARK_OUTCOME: 'success',
        CHECK_NAME: 'Code Reviewed',
        SELECTED_HEAD_SHA: head,
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_RUN_ID: '123',
      },
    )
    expect(output).toContain('conclusion=success')
  })
})
