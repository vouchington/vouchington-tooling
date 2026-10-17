import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gha/ghcr-package-retention.sh',
)
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

const sha = (n: number) => String(n).padStart(40, '0')
const old = '2020-01-01T00:00:00Z'
const days = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z')

interface Version {
  id: number
  created_at: string
  updated_at: string
  metadata: { container: { tags: string[] } }
}

function version(id: number, tags: string[], created = old, updated = created): Version {
  return { id, created_at: created, updated_at: updated, metadata: { container: { tags } } }
}

function shell(cwd: string, command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  expect(result.status).toBe(0)
}

function setup(pages: Record<string, Version[] | string>, commits = 3, shallow = false) {
  const root = mkdtempSync(join(tmpdir(), 'ghcr-history-'))
  temporaryDirectories.push(root)
  const repository = join(root, 'repo')
  mkdirSync(repository)
  shell(repository, 'git', ['init', '-q'])
  const revisions: string[] = []
  for (let index = 0; index < commits; index += 1) {
    shell(repository, 'git', [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      `c${index}`,
    ])
    revisions.push(
      spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).stdout.trim(),
    )
  }
  if (shallow) {
    writeFileSync(join(repository, '.git', 'shallow'), `${revisions[0]}\n`)
  }
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const deletes = join(root, 'deletes')
  writeFileSync(deletes, '')
  writeFileSync(join(root, 'pages.json'), JSON.stringify(pages))
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = api ] && [ "$2" = --method ]; then
  echo "$4" >> "${deletes}"
  exit 0
fi
path=\${!#}
path=\${path%%\\?*}
package=$(basename "$(dirname "$path")")
jq -r --arg package "$package" '.[$package] | if type == "string" then . else "[" + (map(tojson) | join(",")) + "]" end' "${join(root, 'pages.json')}" |
  { read -r first || true; case "$first" in HTTP*) echo "$first" >&2; exit 1 ;; *) echo "$first" ;; esac; }
`,
  )
  chmodSync(join(bin, 'gh'), 0o755)
  return { repository, bin, deletes, revisions }
}

function run(context: ReturnType<typeof setup>, args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', [script, '--main-history', ...args], {
    cwd: context.repository,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${context.bin}:${process.env.PATH ?? ''}`,
      GHCR_OWNER_TYPE: 'org',
      GHCR_OWNER: 'acme',
      ...extraEnv,
    },
  })
}

function deleted(context: ReturnType<typeof setup>) {
  return readFileSync(context.deletes, 'utf8').trim().split('\n').filter(Boolean)
}

describe('ghcr-package-retention --main-history', { timeout: 60_000 }, () => {
  it('plans main, unmerged and orphan deletions as a dry run by default', () => {
    const context = setup({ api: [] })
    const [first, second, third] = context.revisions as [string, string, string]
    const pages = {
      api: [
        version(1, [`sha-${first}`], days(30)),
        version(2, [`sha-${second}`], days(20)),
        version(3, [`sha-${third}`], days(10)),
        version(4, [`sha-${sha(7)}`], days(10)),
        version(5, [`sha-${sha(8)}`], days(1)),
        version(6, [], days(40)),
        version(7, [`sha256-abc`], days(10)),
        version(8, ['latest'], days(10)),
      ],
    }
    writeFileSync(join(context.bin, '..', 'pages.json'), JSON.stringify(pages))
    const result = run(context, ['api'], { GHCR_KEEP_MAIN: '2' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('· api: 8 version(s)')
    expect(result.stdout).toContain('would delete 1 sha-' + first + ' (main)')
    expect(result.stdout).toContain('would delete 4 sha-' + sha(7) + ' (unmerged)')
    expect(result.stdout).toContain('would delete 6 <untagged> (orphan)')
    expect(result.stdout).not.toContain('delete 5 ')
    expect(result.stdout).not.toContain('delete 7 ')
    expect(result.stdout).toContain('Dry run: 3 version(s) would be deleted.')
    expect(deleted(context)).toEqual([])
  })

  it('deletes with --apply and reads packages from GHCR_PACKAGES', () => {
    const context = setup({ api: [], web: [] }, 2)
    const first = context.revisions[0]
    writeFileSync(
      join(context.bin, '..', 'pages.json'),
      JSON.stringify({
        api: [version(1, [`sha-${first}`], days(5)), version(2, [`sha-${context.revisions[1]}`])],
        web: [],
      }),
    )
    const result = run(context, ['--apply'], { GHCR_PACKAGES: 'api web', GHCR_KEEP_MAIN: '1' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('deleted 2')
    expect(result.stdout).toContain('Deleted 1 version(s).')
    expect(deleted(context)).toEqual(['orgs/acme/packages/container/api/versions/2'])
  })

  it('skips missing packages and fails on other listing errors', () => {
    const context = setup({ gone: 'HTTP 404: Not Found (HTTP 404)', broken: 'HTTP 500 (HTTP 500)' })
    const skipped = run(context, ['gone'])
    expect(skipped.status).toBe(0)
    expect(skipped.stdout).toContain('· gone: no such package, skipping')
    const failed = run(context, ['broken'])
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain('::error::Could not list broken versions')
  })

  it('validates its inputs', () => {
    const context = setup({ api: [] })
    expect(run(context, ['api'], { GHCR_KEEP_MAIN: '0' }).stderr).toContain('GHCR_KEEP_MAIN')
    expect(run(context, ['api'], { GHCR_KEEP_MAIN: 'x' }).status).toBe(2)
    expect(run(context, ['api'], { GHCR_UNMERGED_MIN_AGE_DAYS: '-1' }).stderr).toContain(
      'GHCR_UNMERGED_MIN_AGE_DAYS',
    )
    expect(run(context, []).status).toBe(2)
    expect(run(context, ['--bogus']).stderr).toContain('unknown argument')
    const shallow = setup({ api: [] }, 2, true)
    expect(run(shallow, ['api']).stderr).toContain('full main history')
  })
})
