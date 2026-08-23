import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gha/materialize-pr-context.sh',
)
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function writeGhStub(stubBin: string, body: string) {
  writeFileSync(join(stubBin, 'gh'), `#!/bin/sh\n${body}`)
  chmodSync(join(stubBin, 'gh'), 0o755)
}

function runMaterialize(root: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      PR_NUMBER: '42',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_WORKSPACE: join(root, 'workspace'),
      ...extraEnv,
    },
  })
}

describe('materialize-pr-context', () => {
  it('writes PR metadata without crawling when there are no issue refs', () => {
    const root = mkdtempSync(join(tmpdir(), 'materialize-pr-'))
    temporaryDirectories.push(root)
    mkdirSync(join(root, 'bin'))
    mkdirSync(join(root, 'workspace'))
    writeGhStub(
      join(root, 'bin'),
      `case "$*" in
  pr\\ view*) printf '%s\\n' '{"title":"Review me","body":"no refs"}' ;;
  *pulls/*/files*) printf '%s\\n' '[[{"filename":"src/foo.mts"}]]' ;;
  *pulls/*/reviews*) printf '%s\\n' '[[]]' ;;
  *pulls/*/comments*) printf '%s\\n' '[[]]' ;;
  *issues/*/comments*) printf '%s\\n' '[[]]' ;;
  pr\\ diff*) printf '%s\\n' 'diff --git a/src/foo.mts b/src/foo.mts' ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`,
    )
    const result = runMaterialize(root)
    expect(result.status).toBe(0)
    const context = join(root, 'workspace/.review-context')
    expect(JSON.parse(readFileSync(join(context, 'pr.json'), 'utf8'))).toMatchObject({
      title: 'Review me',
    })
    expect(readFileSync(join(context, 'pr.diff'), 'utf8')).toContain('src/foo.mts')
  })

  it('rejects non-integer crawl caps', () => {
    const root = mkdtempSync(join(tmpdir(), 'materialize-pr-bad-'))
    temporaryDirectories.push(root)
    mkdirSync(join(root, 'bin'))
    mkdirSync(join(root, 'workspace'))
    expect(runMaterialize(root, { MAX_MATERIALIZED: 'nope' }).status).toBe(2)
    expect(runMaterialize(root, { MAX_SEEN: 'x' }).stderr).toContain('MAX_SEEN')
  })
})
