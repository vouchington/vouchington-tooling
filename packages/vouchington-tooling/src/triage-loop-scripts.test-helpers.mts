import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const plugin = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../plugins/vouchington-workflow',
)
const scripts = join(plugin, 'skills/triage-loop/scripts')
export const updateDoc = join(plugin, 'skills/triage-sweep/references/dependency-update-check.md')

// gh: the org repo list, and graphql answers read from gql-<connection>-<number>-<cursor|first>.json.
const GH = `#!/usr/bin/env python3
import os, sys
a, d = sys.argv[1:], os.environ["MOCK_DIR"]
if a[:2] == ["api", "--paginate"]:
    print(open(d + "/repos").read())
    sys.exit(0)
v = {x.partition("=")[0]: x.partition("=")[2] for x in a if "=" in x}
conn = "reviewThreads" if "reviewThreads(" in v["query"] else "reviews"
name = f"{d}/gql-{conn}-{v['p']}-{v.get('c', 'first')}.json"
open(d + "/gh.log", "a").write(name + "\\n")
if not os.path.exists(name):
    sys.stderr.write("HTTP 502")
    sys.exit(1)
print(open(name).read())
`
// npx: answers the nth call from hh-<n>.json (exit code from hh-<n>.code) and logs its arguments.
const NPX = `#!/usr/bin/env python3
import json, os, sys, time
d = os.environ["MOCK_DIR"]
n = int(open(d + "/npx.count").read()) + 1 if os.path.exists(d + "/npx.count") else 1
open(d + "/npx.count", "w").write(str(n))
open(d + "/npx.log", "a").write(json.dumps(sys.argv[1:]) + "\\n")
if os.path.exists(f"{d}/hh-{n}.sleep"):
    time.sleep(float(open(f"{d}/hh-{n}.sleep").read()))
if os.path.exists(f"{d}/hh-{n}.code"):
    sys.exit(int(open(f"{d}/hh-{n}.code").read()))
print(open(f"{d}/hh-{n}.json").read())
`

export type Env = ReturnType<typeof makeEnv>

export function makeEnv(extraConfig: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'triage-loop-'))
  const bin = join(dir, 'bin')
  const mock = join(dir, 'mock')
  const stateDir = join(dir, 'state')
  mkdirSync(bin)
  mkdirSync(mock)
  for (const [name, body] of [
    ['gh', GH],
    ['npx', NPX],
  ] as const) {
    writeFileSync(join(bin, name), body)
    chmodSync(join(bin, name), 0o755)
  }
  writeFileSync(join(mock, 'repos'), 'repo-a\nrepo-b\nother\n')
  const config = join(dir, 'config.json')
  const writeConfig = (more: Record<string, unknown>) =>
    writeFileSync(
      config,
      JSON.stringify({
        org: 'org',
        repoPrefix: 'repo-',
        stateDir,
        dependencyBot: { author: 'app/dependabot' },
        ...more,
      }),
    )
  writeConfig(extraConfig)
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    MOCK_DIR: mock,
    TRIAGE_LOOP_CONFIG: config,
  }
  return {
    writeConfig,
    run(script: string, ...args: string[]) {
      const done = spawnSync('python3', ['-I', join(scripts, script), ...args], {
        env,
        encoding: 'utf8',
      })
      return {
        code: done.status,
        out: done.stdout,
        err: done.stderr,
        lines: done.stdout.split('\n').filter(Boolean),
      }
    },
    mock(name: string, value: unknown) {
      writeFileSync(join(mock, name), typeof value === 'string' ? value : JSON.stringify(value))
    },
    gql(
      connection: string,
      number: number,
      nodes: unknown[],
      options: { cursor?: string; next?: string; pull?: object } = {},
    ) {
      const page = { hasNextPage: Boolean(options.next), endCursor: options.next ?? null }
      const pull = {
        state: 'MERGED',
        mergedAt: '2026-11-20T10:00:00Z',
        [connection]: { pageInfo: page, nodes },
      }
      writeFileSync(
        join(mock, `gql-${connection}-${number}-${options.cursor ?? 'first'}.json`),
        JSON.stringify({ data: { repository: { pullRequest: { ...pull, ...options.pull } } } }),
      )
    },
    clean(number: number) {
      this.gql('reviewThreads', number, [{ isResolved: true }])
      this.gql('reviews', number, [{ body: 'early', submittedAt: '2026-11-20T09:00:00Z' }])
    },
    hh(n: number, events: unknown[], extra: Record<string, unknown> = {}) {
      this.mock(`hh-${n}.json`, { events, gap: false, cursor: `c${n}`, ...extra })
    },
    state: () =>
      JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8')) as Record<string, any>,
    seed: (value: unknown) => {
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(join(stateDir, 'state.json'), JSON.stringify(value))
    },
    hhLast: () =>
      JSON.parse(readFileSync(join(stateDir, 'hh-last.json'), 'utf8')) as Record<string, any>,
    log: (name: string) =>
      existsSync(join(mock, name))
        ? readFileSync(join(mock, name), 'utf8').split('\n').filter(Boolean)
        : [],
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

export function mergeEvent(id: string, number: number, bot = false) {
  return {
    id,
    repo: 'org/repo-a',
    event: 'pull_request',
    action: 'closed',
    prs: [number],
    receivedAt: 'x',
    sender: { login: 'jong' },
    payload: {
      pull_request: { number, merged: true, user: { login: bot ? 'dependabot[bot]' : 'jong' } },
    },
  }
}

export const ejection = {
  id: 'e1',
  repo: 'org/repo-a',
  event: 'merge_group',
  action: 'destroyed',
  reason: 'failure',
  headSha: 'abc',
  prs: [9],
}
