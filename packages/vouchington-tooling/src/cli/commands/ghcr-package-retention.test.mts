import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

function runRetention(args: string[], extraEnv: NodeJS.ProcessEnv = {}, ghBody: string) {
  const root = mkdtempSync(join(tmpdir(), 'ghcr-retention-'))
  temporaryDirectories.push(root)
  const fakeBin = join(root, 'bin')
  mkdirSync(fakeBin)
  writeFileSync(join(fakeBin, 'gh'), `#!/usr/bin/env bash\nset -euo pipefail\n${ghBody}\n`)
  chmodSync(join(fakeBin, 'gh'), 0o755)
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      ...extraEnv,
    },
  })
}

describe('ghcr-package-retention', () => {
  it('requires package names and a valid owner type', () => {
    expect(runRetention([], {}, 'exit 99').status).toBe(2)
    expect(runRetention(['pkg'], { GHCR_OWNER_TYPE: 'org' }, 'exit 99').stderr).toContain(
      'GHCR_OWNER',
    )
    expect(runRetention(['pkg'], { GHCR_OWNER_TYPE: 'team' }, 'exit 99').status).toBe(2)
    expect(runRetention(['pkg'], { KEEP_MIN: 'nope' }, 'exit 99').status).toBe(2)
  })

  it('keeps protected and recent versions then deletes the rest', () => {
    const result = runRetention(
      ['example%2Fapi'],
      { KEEP_MIN: '1' },
      `
if [[ "$*" == *"-X DELETE"* ]]; then
  echo "deleted"
  exit 0
fi
printf '%s\\n' \\
  '{"id":1,"metadata":{"container":{"tags":["latest"]}}}' \\
  '{"id":2,"metadata":{"container":{"tags":["sha-aaaa"]}}}' \\
  '{"id":3,"metadata":{"container":{"tags":["sha-bbbb"]}}}'
`,
    )
    expect({ status: result.status, stderr: result.stderr, stdout: result.stdout }).toMatchObject({
      status: 0,
    })
    expect(result.stdout).toContain('keep (protected tag): version 1')
    expect(result.stdout).toContain('keep (recent 1/1): version 2')
    expect(result.stdout).toContain('delete: version 3')
  })
})
