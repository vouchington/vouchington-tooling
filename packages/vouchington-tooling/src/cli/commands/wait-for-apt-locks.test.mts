import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = join(process.cwd(), 'packages/vouchington-tooling/scripts/gha/wait-for-apt-locks.sh')

describe('wait-for-apt-locks', () => {
  it('no-ops on non-Linux hosts', () => {
    if (process.platform === 'linux') return
    const result = spawnSync('bash', [script], { encoding: 'utf8' })
    expect(result.status).toBe(0)
  })

  it('rejects a non-integer timeout', () => {
    const result = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: { ...process.env, APT_LOCK_TIMEOUT_SECONDS: 'nope' },
    })
    if (process.platform === 'linux') {
      expect(result.status).toBe(2)
      expect(result.stderr + result.stdout).toContain('APT_LOCK_TIMEOUT_SECONDS')
    } else {
      expect(result.status).toBe(0)
    }
  })
})
