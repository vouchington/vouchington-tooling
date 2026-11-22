import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const scripts = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../plugins/vouchington-workflow/skills/ci-report/scripts',
)
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A fake `gh`: the first route whose key occurs in the request path answers; {error} fails. */
const fakeGh = `#!/usr/bin/env python3
import json, os, sys
args = sys.argv[2:]
method = args[1] if args[0] == "-X" else "GET"
path = args[-1]
with open(os.environ["FAKE_GH_LOG"], "a") as log:
    log.write(method + " " + path + "\\n")
for key, value in json.load(open(os.environ["FAKE_GH_ROUTES"])):
    if key in path:
        if isinstance(value, dict) and "error" in value:
            sys.stderr.write("gh: failed (HTTP %d)\\n" % value["error"])
            sys.exit(1)
        print(json.dumps(value))
        sys.exit(0)
sys.stderr.write("gh: no route (HTTP 404)\\n")
sys.exit(1)
`

type Route = [string, unknown]

function harness(routes: Route[]) {
  const root = mkdtempSync(join(tmpdir(), 'ci-report-'))
  roots.push(root)
  const gh = join(root, 'gh')
  writeFileSync(gh, fakeGh)
  chmodSync(gh, 0o755)
  writeFileSync(join(root, 'routes.json'), JSON.stringify(routes))
  const log = join(root, 'log')
  writeFileSync(log, '')
  const run = (script: string, ...args: string[]) =>
    spawnSync('python3', [join(scripts, script), ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ''}`,
        FAKE_GH_ROUTES: join(root, 'routes.json'),
        FAKE_GH_LOG: log,
      },
    })
  const posts = () =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('POST'))
  return { run, posts }
}

const iso = (hoursAgo: number, extraSeconds = 0) =>
  new Date(Date.now() - hoursAgo * 3_600_000 + extraSeconds * 1000).toISOString()
const limit = {
  resources: { core: { remaining: 9, limit: 10 }, graphql: { remaining: 8, limit: 10 } },
}

function wfRun(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    name: 'CI',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    created_at: iso(1),
    run_started_at: iso(1, 10),
    updated_at: iso(1, 70),
    head_branch: 'feat',
    pull_requests: [{ number: 5 }],
    run_attempt: 1,
    ...over,
  }
}

describe('ci-report report.py', () => {
  const jobs = {
    jobs: [
      {
        name: 'test',
        labels: ['macos-14'],
        conclusion: 'failure',
        started_at: iso(1),
        completed_at: iso(1, 120),
        steps: [{ name: 'Run tests', conclusion: 'failure' }],
      },
      {
        name: 'test',
        labels: ['macos-14'],
        conclusion: 'success',
        started_at: iso(1),
        completed_at: iso(1, 61),
        steps: [],
      },
      {
        name: 'lint',
        labels: ['ubuntu-latest'],
        conclusion: 'skipped',
        started_at: null,
        completed_at: null,
        steps: [],
      },
    ],
  }
  const routes = (runs: unknown[]): Route[] => [
    ['rate_limit', limit],
    ['/jobs', jobs],
    [
      'rules/branches/main',
      [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'ci' }] },
        },
      ],
    ],
    ['/pulls', [{ number: 5, draft: true }]],
    ['actions/runs?', { total_count: runs.length, workflow_runs: runs }],
    ['repos/o/r', { default_branch: 'main' }],
  ]

  it('computes percentiles, billed minutes, signatures, ejections, and reruns', () => {
    const runs = [
      ...[10, 20, 30, 40].map((s, i) => wfRun(10 + i, { updated_at: iso(1, 10 + s) })),
      wfRun(20, {
        event: 'merge_group',
        conclusion: 'failure',
        head_branch: 'gh-readonly-queue/main/pr-77-abc',
        pull_requests: [],
      }),
      wfRun(21, { run_attempt: 2 }),
    ]
    const { run } = harness(routes(runs))
    const result = run('report.py', '--repo', 'o/r', '--events', 'pull_request', '--json')
    expect(result.status).toBe(0)
    const out = JSON.parse(result.stdout)
    const wf = out.workflows.find((w: { event: string }) => w.event === 'pull_request')
    expect(wf.n).toBe(5)
    expect(wf.wall.p50).toBeCloseTo(30, 0)
    expect(wf.wall.p90).toBeCloseTo(60, 0)
    expect(wf.queue.p50).toBeCloseTo(10, 0)
    expect(out.ejections).toEqual([{ pr: 77, runs: [20], count: 1 }])
    expect(out.rerunSuccess).toEqual({ CI: 1 })
    expect(out.requiredChecks).toEqual(['ci'])
    expect(out.draftRuns).toMatchObject({ draft: 5 })
    const job = out.jobs.find((j: { job: string }) => j.job === 'test')
    expect(job.runner).toBe('macos-14')
    expect(job.failures).toBeGreaterThan(0)
    expect(out.runnerMinutes[0]).toMatchObject({ label: 'macos-14', multiplier: 10 })
    expect(out.signatures[0]).toMatchObject({ job: 'test', step: 'Run tests' })
    expect(out.rateBefore.core.remaining).toBe(9)
  })

  it('counts skipped jobs with null timestamps without failing, and prints compact lines', () => {
    const { run } = harness(routes([wfRun(30)]))
    const result = run('report.py', '--repo', 'o/r', '--events', 'pull_request')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('wf CI pull_request n=1')
    expect(result.stdout).toContain('jobs-skipped-only 1')
    expect(result.stdout).toContain('runner macos-14')
    const json = JSON.parse(
      run('report.py', '--repo', 'o/r', '--events', 'pull_request', '--json').stdout,
    )
    const lint = json.jobs.find((j: { job: string }) => j.job === 'lint')
    expect(lint).toMatchObject({ skipped: 1, n: 0, median: null })
  })

  it('stops at the api-call cap and says what it cut', () => {
    const { run } = harness(routes([wfRun(30), wfRun(31)]))
    const result = run('report.py', '--repo', 'o/r', '--events', 'pull_request', '--max-calls', '4')
    expect(result.stderr + result.stdout).toMatch(/cap 4/)
  })
})

describe('ci-report stale.py', () => {
  const stuck = [
    wfRun(1, { status: 'queued', conclusion: null, created_at: iso(30), run_started_at: null }),
    wfRun(2, { status: 'queued', conclusion: null, created_at: iso(2), run_started_at: null }),
    wfRun(3, {
      status: 'queued',
      conclusion: null,
      created_at: iso(8),
      run_started_at: null,
      event: 'merge_group',
      head_branch: 'gh-readonly-queue/main/pr-9-abc',
      pull_requests: [],
    }),
  ]
  const routes: Route[] = [
    ['actions/runs?status=queued', { total_count: 3, workflow_runs: stuck }],
    ['actions/runs?status', { total_count: 0, workflow_runs: [] }],
    ['/cancel', {}],
  ]

  it('lists only runs older than the threshold, and a dry run makes no POST', () => {
    const { run, posts } = harness(routes)
    const result = run('stale.py', '--repo', 'o/r', '--dry-run')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('n=2 mode=dry-run')
    expect(result.stdout).toContain('1 CI pull_request PR#5 queued 30.0h')
    expect(result.stdout).toContain('PR#9(queue)')
    expect(result.stdout).not.toContain('\n2 CI')
    expect(posts()).toEqual([])
  })

  it('cancels each stale run by default and never the younger one', () => {
    const { run, posts } = harness(routes)
    const result = run('stale.py', '--repo', 'o/r')
    expect(result.stdout).toContain('-> cancelled')
    expect(posts()).toEqual([
      'POST repos/o/r/actions/runs/1/cancel',
      'POST repos/o/r/actions/runs/3/cancel',
    ])
  })

  it('applies a longer threshold', () => {
    const { run, posts } = harness(routes)
    expect(run('stale.py', '--repo', 'o/r', '--older-than', '24h').stdout).toContain('n=1')
    expect(posts()).toEqual(['POST repos/o/r/actions/runs/1/cancel'])
  })

  it('force-cancels only after a 409 on a run that is still stuck', () => {
    const { run, posts } = harness([
      ['runs/1/cancel', { error: 409 }],
      ['runs/1/force-cancel', {}],
      ['actions/runs/1', stuck[0]],
      ...routes,
    ])
    const result = run('stale.py', '--repo', 'o/r', '--older-than', '24h')
    expect(result.stdout).toContain('-> force-cancelled')
    expect(posts().at(-1)).toBe('POST repos/o/r/actions/runs/1/force-cancel')
  })

  it('leaves a run alone when a 409 shows it already finished', () => {
    const { run, posts } = harness([
      ['runs/1/cancel', { error: 409 }],
      ['actions/runs/1', { ...stuck[0], status: 'completed' }],
      ...routes,
    ])
    expect(run('stale.py', '--repo', 'o/r', '--older-than', '24h').stdout).toContain('left alone')
    expect(posts().some((call) => call.includes('force-cancel'))).toBe(false)
  })

  it('rejects a threshold under one hour and bad input', () => {
    const { run } = harness(routes)
    expect(run('stale.py', '--repo', 'o/r', '--older-than', '30m').stderr).toContain('at least 1h')
    expect(run('stale.py', '--repo', 'o/r', '--older-than', 'soon').status).not.toBe(0)
    expect(run('stale.py', '--repo', 'o/r', '--status', 'done').status).not.toBe(0)
  })
})
