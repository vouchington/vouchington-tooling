import { describe, expect, it } from 'vitest'

import { runStorybookBrowserTests } from './index.mts'
import { PROJECT, exitChild, makeChild, makeDeps } from './fixtures.test-helpers.mts'

const baseEnv = { CI: '', RUNNER_TEMP: '' }

describe('storybook browser runner spawning', () => {
  it('fails without retrying when the command emits a spawn error', async () => {
    const child = makeChild(100)
    const harness = makeDeps([child])
    const run = runStorybookBrowserTests(PROJECT, { env: baseEnv }, harness.deps)
    child.emit('error', new Error('spawn pnpm ENOENT'))
    exitChild(child, null)
    await expect(run).resolves.toBe(1)
    expect(harness.stderr.join('')).toContain('failed to start browser test command: spawn pnpm')
    expect(harness.spawnCalls).toHaveLength(1)
  })

  it('fails when the spawned command has no process ID', async () => {
    const harness = makeDeps([makeChild(undefined)])
    await expect(runStorybookBrowserTests(PROJECT, { env: baseEnv }, harness.deps)).resolves.toBe(1)
    expect(harness.stderr.join('')).toContain('spawned browser test command without a process ID')
    expect(harness.written[0]!.content).toContain('retryable=false')
  })

  it('rethrows start-up errors that are not spawn failures', async () => {
    const harness = makeDeps([])
    await expect(runStorybookBrowserTests(PROJECT, { env: baseEnv }, harness.deps)).rejects.toThrow(
      'unexpected spawn',
    )
  })

  it('reports an expired session budget as a non-retryable failure', async () => {
    const child = makeChild(100)
    const harness = makeDeps([child])
    const run = runStorybookBrowserTests(
      PROJECT,
      { env: { ...baseEnv, STORYBOOK_BROWSER_SESSION_BUDGET_MS: '1000' } },
      harness.deps,
    )
    exitChild(child, null, 'SIGTERM')
    await expect(run).resolves.toBe(1)
    expect(harness.written[0]!.content).toContain('budgetExpired=true')
    expect(harness.written[0]!.content).toContain('retryable=false')
    expect(harness.spawnCalls).toHaveLength(1)
  })

  it('fails without spawning when the session budget is gone before the first attempt', async () => {
    const harness = makeDeps([makeChild(100)], {
      now: (() => {
        let t = 0
        return () => (t += 10_000)
      })(),
    })
    const run = runStorybookBrowserTests(
      PROJECT,
      { env: { ...baseEnv, STORYBOOK_BROWSER_SESSION_BUDGET_MS: '1000' } },
      harness.deps,
    )
    await expect(run).resolves.toBe(1)
    expect(harness.spawnCalls).toHaveLength(0)
    expect(harness.written[0]!.content).toContain('budgetExpired=true')
  })
})
