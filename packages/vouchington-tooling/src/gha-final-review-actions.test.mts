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
  const calls = join(directory, 'calls')
  const gh = join(directory, 'gh')
  await writeFile(
    gh,
    `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' "$*" >> "$RUNNER_TEMP/calls"\necho mock-warning >&2\n${mock}`,
  )
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
    const capturedOutput = await readFile(output, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    return { output: capturedOutput, calls: await readFile(calls, 'utf8') }
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
    expect(select.inputs).not.toHaveProperty('event-name')
    expect(select.runs?.steps?.[0]?.env?.['EVENT_NAME']).toBe('${{ github.event_name }}')
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
    expect(script).toContain('.run_attempt <= $attempt')
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
      'source-run-attempt': { required: true },
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
      SOURCE_RUN_ATTEMPT: '${{ inputs.source-run-attempt }}',
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
    expect(script).toContain('source_attempt" != "$SOURCE_RUN_ATTEMPT')
    expect(script).toContain('capture("/actions/runs/(?<id>[0-9]+)(/|$)")')
    expect(script).toContain('.run_attempt <= $attempt')
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
    const { output } = await runWithMockGh(
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
    const { output } = await runWithMockGh(
      '.github/actions/request-final-review/request-final-review.sh',
      mock,
      {
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
      },
    )
    expect(output).toContain('requested=true')
    expect(output).toContain('decision=requested')
  })

  it('recognizes a published selected-head check whose run URL has no trailing slash', async () => {
    const mock = `
case "$*" in
  *"actions/runs/99/jobs"*) printf '%s\\n' '[{"jobs":[{"id":1,"run_attempt":1,"name":"tests","conclusion":"success"}]}]' ;;
  *"actions/runs/99"*) printf '%s\\n' '{"path":".github/workflows/ci.yml","event":"pull_request","head_sha":"${head}","head_repository":{"full_name":"owner/repo"},"status":"completed","run_attempt":1,"pull_requests":[{"number":7,"base":{"sha":"${base}"}}]}' ;;
  *"actions/runs/123"*) printf '%s\\n' '{"path":".github/workflows/final-code-review.yml","event":"repository_dispatch"}' ;;
  *"pulls/7"*) printf '%s\\n' '${pr}' ;;
  *"commits/${head}/check-runs"*) printf '%s\\n' '[{"check_runs":[{"id":1,"name":"Code Reviewed","status":"completed","conclusion":"success","details_url":"https://github.com/owner/repo/actions/runs/123","app":{"slug":"github-actions"}}]}]' ;;
  *) echo "unexpected gh call: $*" >&2; exit 64 ;;
esac`
    const { output, calls } = await runWithMockGh(
      '.github/actions/request-final-review/request-final-review.sh',
      mock,
      requestEnv(),
    )
    expect(output).toContain('decision=duplicate')
    expect(calls).not.toContain('/dispatches')
  })

  it('clears pending and complete labels when the exact source fan-in fails', async () => {
    const mock = `
case "$*" in
  *"actions/runs/99/jobs"*) printf '%s\\n' '[{"jobs":[{"id":1,"run_attempt":1,"name":"tests","conclusion":"failure"}]}]' ;;
  *"actions/runs/99"*) printf '%s\\n' '{"path":".github/workflows/ci.yml","event":"pull_request","head_sha":"${head}","head_repository":{"full_name":"owner/repo"},"status":"completed","run_attempt":1,"pull_requests":[{"number":7,"base":{"sha":"${base}"}}]}' ;;
  *"pulls/7"*) printf '%s\\n' '${pr}' ;;
  *"--method DELETE"*"/labels/final-code-review%3A"*) : ;;
  *) echo "unexpected gh call: $*" >&2; exit 64 ;;
esac`
    const { output, calls } = await runWithMockGh(
      '.github/actions/request-final-review/request-final-review.sh',
      mock,
      requestEnv(),
    )
    expect(output).toContain('decision=ineligible')
    expect(calls.match(/--method DELETE/g)).toHaveLength(2)
    expect(calls).not.toContain('/dispatches')
  })

  it('does not let an older failed attempt clear labels owned by a newer rerun', async () => {
    const mock = `
case "$*" in
  *"actions/runs/99/jobs"*) printf '%s\\n' '[{"jobs":[{"id":1,"run_attempt":1,"name":"tests","conclusion":"failure"}]}]' ;;
  *"actions/runs/99"*)
    count="$(grep -c 'actions/runs/99$' "$RUNNER_TEMP/calls")"
    attempt=1; [ "$count" -eq 1 ] || attempt=2
    printf '{"path":".github/workflows/ci.yml","event":"pull_request","head_sha":"${head}","head_repository":{"full_name":"owner/repo"},"status":"completed","run_attempt":%s,"pull_requests":[{"number":7,"base":{"sha":"${base}"}}]}\\n' "$attempt" ;;
  *"pulls/7"*) printf '%s\\n' '${pr}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 64 ;;
esac`
    const { output, calls } = await runWithMockGh(
      '.github/actions/request-final-review/request-final-review.sh',
      mock,
      requestEnv(),
    )
    expect(output).toContain('decision=stale')
    expect(calls).not.toContain('--method DELETE')
  })

  it('publishes the required check on the selected pull-request head', () => {
    const gate = action(`${root}/final-review-gate/action.yml`)
    expect(gate.inputs).toMatchObject({
      token: { required: true },
      pr_number: { required: true },
      selected_head_sha: { required: true },
      selected_base_sha: { required: true },
      default_branch: { required: true },
      complete_label: { required: true },
      check_name: { default: '' },
      requested_label: { default: '' },
    })
    expect(gate.runs?.steps?.[0]?.env).toMatchObject({
      GH_TOKEN: '${{ inputs.token }}',
      PR_NUMBER: '${{ inputs.pr_number }}',
      SELECTED_HEAD_SHA: '${{ inputs.selected_head_sha }}',
      SELECTED_BASE_SHA: '${{ inputs.selected_base_sha }}',
      DEFAULT_BRANCH: '${{ inputs.default_branch }}',
    })
    expect(gate.runs?.steps?.[1]?.env).toMatchObject({
      COMPLETE_LABEL: '${{ inputs.complete_label }}',
      REQUESTED_LABEL: '${{ inputs.requested_label }}',
    })
    const publish = readFileSyncNode(`${root}/final-review-gate/publish-check.sh`, 'utf8')
    const requireGate = readFileSyncNode(`${root}/final-review-gate/require.sh`, 'utf8')
    expect(publish).toContain('repos/$GITHUB_REPOSITORY/check-runs')
    expect(publish).toContain('head_sha=$SELECTED_HEAD_SHA')
    expect(publish).toContain('GATE_STATUS')
    expect(publish).toContain('untrusted) if [ "$MARK_OUTCOME" = success ]')
    expect(requireGate).toContain('CHECK_CONCLUSION')
    expect(requireGate).toContain('review|untrusted) [ "$MARK_OUTCOME" = success ]')
  })

  it('executes selected-head check publication after a successful gate', async () => {
    const { output } = await runWithMockGh(
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

  it('publishes failure when untrusted pending-label cleanup fails', async () => {
    const { output } = await runWithMockGh(
      '.github/actions/final-review-gate/publish-check.sh',
      `case "$*" in
        *"check-runs"*"head_sha=${head}"*"conclusion=failure"*) : ;;
        *) echo "unexpected gh call: $*" >&2; exit 64 ;;
      esac`,
      {
        GH_TOKEN: 'write',
        GH_RETRY_ATTEMPTS: '3',
        GH_RETRY_BACKOFF_SECONDS: '0',
        GH_RETRY_TRANSPORT_MARKERS: 'unexpected EOF',
        GATE_OUTCOME: 'success',
        GATE_STATUS: 'untrusted',
        MARK_OUTCOME: 'failure',
        CHECK_NAME: 'Code Reviewed',
        SELECTED_HEAD_SHA: head,
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_RUN_ID: '123',
      },
    )
    expect(output).toContain('conclusion=failure')
  })

  it('removes the pending label after recording trusted completion', async () => {
    const { calls } = await runWithMockGh(
      '.github/actions/final-review-gate/mark-complete.sh',
      `case "$*" in
        *"pulls/7"*) printf '%s\\n' '${pr}' ;;
        *"--method POST"*"/labels"*"labels[]=final-code-review:complete"*) : ;;
        *"--method DELETE"*"/labels/final-code-review%3Arequested"*) : ;;
        *) echo "unexpected gh call: $*" >&2; exit 64 ;;
      esac`,
      {
        GH_TOKEN: 'write',
        GH_RETRY_ATTEMPTS: '3',
        GH_RETRY_BACKOFF_SECONDS: '0',
        GH_RETRY_TRANSPORT_MARKERS: 'unexpected EOF',
        PR_NUMBER: '7',
        SELECTED_HEAD_SHA: head,
        SELECTED_BASE_SHA: base,
        DEFAULT_BRANCH: 'main',
        GATE_STATUS: 'review',
        COMPLETE_LABEL: 'final-code-review:complete',
        REQUESTED_LABEL: 'final-code-review:requested',
      },
    )
    expect(calls).toContain('labels[]=final-code-review:complete')
    expect(calls).toContain('labels/final-code-review%3Arequested')
  })
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
