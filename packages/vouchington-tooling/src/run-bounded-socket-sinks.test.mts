import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(packageRoot, 'scripts/run-bounded.py')
const fixtures = join(packageRoot, 'scripts/run-bounded-fixtures')

function fixture(name: string, ...args: string[]) {
  const result = spawnSync('python3', [join(fixtures, `${name}.py`), script, ...args], {
    encoding: 'utf8',
    timeout: 7000,
  })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  return JSON.parse(result.stdout)
}

describe('run-bounded socket sinks', () => {
  it('drains source output after an actual TCP peer reset and retains command status', () => {
    expect(fixture('run-bounded-reset-socket')).toEqual({ status: 3, stderr: 'err\n' })
  })

  it('waits for a nonblocking sink and retains both admitted source chunks', async () => {
    const child = spawn('python3', [
      join(fixtures, 'run-bounded-backpressure.py'),
      script,
      'nonblocking',
    ])
    let stdout = ''
    let stderr = ''
    let observedError: Error | undefined
    const recordError = (err: Error) => {
      observedError ??= err
    }
    child.stdin.on('error', recordError)
    child.stdout.on('data', (data) => {
      stdout += data
    })
    child.stderr.on('data', (data) => {
      stderr += data
    })
    const closed = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    void closed.catch(recordError)
    onTestFinished(async () => {
      child.stdin.end()
      await closed
      if (observedError) throw observedError
    })
    expect(await closed).toBe(0)
    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual({
      status: 3,
      stdout: `${'a'.repeat(8191)}z${'b'.repeat(4095)}y`,
      sourceHolderStatus: 0,
      wrapperDrained: true,
    })
  }, 30_000)
})
