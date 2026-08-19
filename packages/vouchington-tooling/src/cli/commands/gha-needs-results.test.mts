import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const script = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gha/check-needs-results.sh',
)

describe('check-needs-results', () => {
  it('fails when RESULTS is missing', async () => {
    await expect(
      execFileAsync('bash', [script], { env: { ...process.env, RESULTS: '' } }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('RESULTS is required'),
    })
  })

  it('fails when a needed job failed or was cancelled', async () => {
    await expect(
      execFileAsync('bash', [script, 'required jobs'], {
        env: {
          ...process.env,
          RESULTS: '{"static-code-analysis":{"result":"failure"}}',
        },
      }),
    ).rejects.toMatchObject({ code: 1 })
    await expect(
      execFileAsync('bash', [script], {
        env: {
          ...process.env,
          RESULTS: '{"build":{"result":"cancelled"}}',
        },
      }),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining('failed or were cancelled'),
    })
  })

  it('passes when required jobs succeeded or were skipped', async () => {
    const { stdout } = await execFileAsync('bash', [script, 'gate jobs'], {
      env: {
        ...process.env,
        RESULTS: '{"lint":{"result":"success"},"optional":{"result":"skipped"}}',
      },
    })
    expect(stdout).toContain('All gate jobs passed or were skipped')
  })
})
