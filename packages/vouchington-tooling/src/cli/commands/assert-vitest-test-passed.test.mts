import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gha/assert-vitest-test-passed.sh',
)
const testRoots: string[] = []

function reportFixture(assertionResults: Array<{ fullName: string; status: string }>): string {
  const root = mkdtempSync(join(tmpdir(), 'assert-vitest-test-passed-'))
  testRoots.push(root)
  const reportPath = join(root, 'report.json')
  writeFileSync(reportPath, JSON.stringify({ testResults: [{ assertionResults }] }))
  return reportPath
}

afterEach(() => {
  for (const root of testRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('assert-vitest-test-passed', () => {
  it('exits 0 and echoes the status when the named test passed', () => {
    const reportPath = reportFixture([{ fullName: 'suite passed test', status: 'passed' }])

    const result = spawnSync('bash', [script, reportPath, 'suite passed test'], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('test "suite passed test": passed')
  })

  it('fails when the named test was skipped', () => {
    const reportPath = reportFixture([{ fullName: 'suite skipped test', status: 'skipped' }])

    const result = spawnSync('bash', [script, reportPath, 'suite skipped test'], {
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('status: skipped')
  })

  it('fails with status "absent" when the named test is not in the report', () => {
    const reportPath = reportFixture([{ fullName: 'a different test', status: 'passed' }])

    const result = spawnSync('bash', [script, reportPath, 'suite missing test'], {
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('status: absent')
  })

  it('fails when the report file does not exist', () => {
    const reportPath = join(tmpdir(), 'assert-vitest-test-passed-does-not-exist.json')

    const result = spawnSync('bash', [script, reportPath, 'suite passed test'], {
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('vitest report not found')
  })

  it('fails fast with usage when arguments are missing', () => {
    const result = spawnSync('bash', [script], { encoding: 'utf8' })

    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('usage:')
  })
})
