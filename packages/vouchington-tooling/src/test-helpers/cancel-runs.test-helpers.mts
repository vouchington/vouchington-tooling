import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Run = { id: number; name: string; head_branch: string | null }
type Status = 'queued' | 'in_progress' | 'waiting' | 'requested' | 'pending'

export type Scenario = {
  reason?: string
  pr?: string
  queueBase?: string
  merged?: boolean
  runId?: number
  pages?: Partial<Record<Status, string[]>>
  jobs?: Record<number, string>
  conflicts?: number[]
  errors?: number[]
  jobErrors?: number[]
  transient?: number[]
  transientFailures?: number
  env?: Record<string, string>
}

// Synthetic queue refs: real shas would trip the repository's no-test-git-sha rule.
export const sha = (digit: string) => digit.repeat(40)
export const branch = (pr: number, digit: string) => `gh-readonly-queue/main/pr-${pr}-${sha(digit)}`
export const run = (id: number, name: string, head_branch: string | null): Run => ({
  id,
  name,
  head_branch,
})
export const page = (...runs: Run[]) =>
  JSON.stringify({ total_count: runs.length, workflow_runs: runs })
export const jobsOf = (...conclusions: string[]) =>
  JSON.stringify({ jobs: conclusions.map((conclusion, i) => ({ name: `job-${i}`, conclusion })) })

// A fake `gh` serves stored run lists, job lists and merge state, and records cancel requests; the
// real `jq` and the real workflow script run unchanged.
const fakeGh = `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_GH_DIR/calls"
url="\${!#}"
case "$*" in
  *"--method POST"*)
    id="\${url#*/runs/}"
    id="\${id%/cancel}"
    case " $FAKE_CONFLICT_IDS " in *" $id "*) echo 'gh: Cannot cancel a workflow run that is completed. (HTTP 409)' >&2; exit 1 ;; esac
    case " $FAKE_ERROR_IDS " in *" $id "*) echo 'gh: Internal Server Error (HTTP 500)' >&2; exit 1 ;; esac
    case " $FAKE_TRANSIENT_IDS " in
      *" $id "*)
        count_file="$FAKE_GH_DIR/transient-$id"
        count=0
        if [[ -f "$count_file" ]]; then count=$(cat "$count_file"); fi
        count=$((count + 1))
        printf '%s\\n' "$count" > "$count_file"
        if [[ "$count" -le "\${FAKE_TRANSIENT_FAILURES:-1}" ]]; then
          echo 'gh: Server Error (HTTP 502)' >&2
          exit 1
        fi
        ;;
    esac
    printf '%s\\n' "$id" >> "$FAKE_GH_DIR/cancelled"
    exit 0 ;;
  *"/jobs?"*)
    id="\${url#*/runs/}"
    id="\${id%%/jobs*}"
    case " $FAKE_JOB_ERROR_IDS " in *" $id "*) echo 'gh: Bad Gateway (HTTP 502)' >&2; exit 1 ;; esac
    file="$FAKE_GH_DIR/jobs-$id.json"
    if [[ -f "$file" ]]; then cat "$file"; else echo '{"jobs":[{"name":"build","conclusion":"success"}]}'; fi
    exit 0 ;;
  *"/pulls/"*)
    echo "$FAKE_MERGED"
    exit 0 ;;
esac
[[ "$1 $2" == "api --paginate" ]] || { echo "unexpected gh call: $*" >&2; exit 99; }
status="\${url#*status=}"
status="\${status%%&*}"
file="$FAKE_GH_DIR/list-$status.json"
if [[ -f "$file" ]]; then cat "$file"; else echo '{"total_count":0,"workflow_runs":[]}'; fi
`

export function createHarness(script: string, defaultEnv: Record<string, string> = {}) {
  let directory = ''
  const lines = (name: string): string[] => {
    try {
      return readFileSync(join(directory, name), 'utf8').split('\n').filter(Boolean)
    } catch {
      return []
    }
  }

  return {
    setup: () => {
      directory = mkdtempSync(join(tmpdir(), 'cancel-runs-'))
      writeFileSync(join(directory, 'gh'), fakeGh)
      chmodSync(join(directory, 'gh'), 0o755)
    },
    teardown: () => {
      rmSync(directory, { recursive: true, force: true })
    },
    execute: (scenario: Scenario) => {
      for (const name of ['cancelled', 'calls', 'summary.md']) {
        rmSync(join(directory, name), { force: true })
      }
      for (const [status, pages] of Object.entries(scenario.pages ?? {})) {
        writeFileSync(join(directory, `list-${status}.json`), (pages ?? []).join('\n'))
      }
      for (const [id, body] of Object.entries(scenario.jobs ?? {})) {
        writeFileSync(join(directory, `jobs-${id}.json`), body)
      }
      const result = spawnSync('/bin/bash', ['-c', script], {
        encoding: 'utf8',
        env: {
          PATH: `${directory}:${process.env.PATH ?? ''}`,
          FAKE_GH_DIR: directory,
          FAKE_CONFLICT_IDS: (scenario.conflicts ?? []).join(' '),
          FAKE_ERROR_IDS: (scenario.errors ?? []).join(' '),
          FAKE_JOB_ERROR_IDS: (scenario.jobErrors ?? []).join(' '),
          FAKE_TRANSIENT_IDS: (scenario.transient ?? []).join(' '),
          FAKE_TRANSIENT_FAILURES: String(scenario.transientFailures ?? 1),
          FAKE_MERGED: String(scenario.merged ?? false),
          GH_TOKEN: 'token',
          PR_NUMBER: scenario.pr ?? '14',
          QUEUE_BASE: scenario.queueBase ?? 'main',
          REASON: scenario.reason ?? 'CI_FAILURE',
          GITHUB_REPOSITORY: 'example/repo',
          GITHUB_RUN_ID: String(scenario.runId ?? 500),
          GITHUB_SERVER_URL: 'https://github.test',
          GITHUB_STEP_SUMMARY: join(directory, 'summary.md'),
          RUNNER_TEMP: directory,
          ...defaultEnv,
          ...scenario.env,
        },
      })
      return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        cancelled: lines('cancelled')
          .map(Number)
          .toSorted((a, b) => a - b),
        calls: lines('calls'),
        summary: lines('summary.md').join('\n'),
      }
    },
  }
}
