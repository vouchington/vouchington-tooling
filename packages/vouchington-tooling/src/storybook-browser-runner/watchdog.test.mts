import { describe, expect, it } from 'vitest'

import { runStorybookBrowserTests } from './index.mts'
import {
  PROJECT,
  PROJECT_NAME,
  exitChild,
  fetchFailure,
  makeChild,
  makeDeps,
  progress,
  waitFor,
} from './fixtures.test-helpers.mts'
import { isSpawnedProcessGroupId } from './watchdog.mts'

const baseEnv = { CI: '', RUNNER_TEMP: '', STORYBOOK_BROWSER_STARTUP_ATTEMPTS: '2' }

function setup(count = 2, existing: (path: string) => boolean = () => false) {
  const clock = { t: 0 }
  const children = Array.from({ length: count }, (_, i) => makeChild(100 + i))
  const harness = makeDeps(children, { exists: existing, now: () => clock.t })
  const run = runStorybookBrowserTests(PROJECT, { env: baseEnv }, harness.deps)
  const tick = (ms: number) => {
    clock.t += ms
    harness.intervals[0]!.callback()
  }
  return { children, clock, harness, run, tick }
}

describe('storybook browser watchdog', () => {
  it('terminates an optimizer that makes no progress and retries with a new cache', async () => {
    const { children, harness, run, tick } = setup()
    children[0]!.stdout.emit('data', '[optimizer] scanning dependencies\n')
    tick(29_000)
    expect(harness.killed).toEqual([])
    tick(1_000)
    expect(harness.killed[0]).toEqual({ pid: 100, signal: 'SIGTERM' })
    expect(harness.stderr.join('')).toContain('Vite optimizer made no startup progress for 30000ms')
    exitChild(children[0]!, null, 'SIGTERM')
    await waitFor(() => harness.spawnCalls.length === 2)
    exitChild(children[1]!, 0)
    await expect(run).resolves.toBe(0)
    expect(harness.written[0]!.content).toContain('stall=true')
    expect(harness.written[0]!.content).toContain('resolvedCode=1')
  })

  it('stops tracking the optimizer once dependencies are optimized', async () => {
    const { children, run, harness, tick } = setup()
    children[0]!.stdout.emit('data', '[optimizer] bundling dependencies\n')
    children[0]!.stdout.emit('data', 'dependencies optimized\n')
    tick(600_000)
    expect(harness.killed.filter((k) => k.signal === 'SIGTERM')).toHaveLength(1)
    exitChild(children[0]!, null, 'SIGTERM')
    await waitFor(() => harness.spawnCalls.length === 2)
    exitChild(children[1]!, 0)
    await run
    expect(harness.written[0]!.content).toContain('stall=false')
    expect(harness.written[0]!.content).toContain('hang=true')
  })

  it('does not retry a mid-suite stall after semantic progress', async () => {
    const { children, harness, run, tick } = setup()
    children[0]!.stdout.emit('data', progress(1))
    tick(119_000)
    expect(harness.killed).toEqual([])
    tick(1_000)
    expect(harness.stderr.join('')).toContain('no semantic test progress for 120000ms')
    exitChild(children[0]!, null, 'SIGTERM')
    await expect(run).resolves.toBe(1)
    expect(harness.spawnCalls).toHaveLength(1)
    expect(harness.written[0]!.content).toContain('semanticStall=true')
    expect(harness.written[0]!.content).toContain('retryable=false')
  })

  it('retries a tester-connection hang before any test output', async () => {
    const { children, harness, run, tick } = setup()
    children[0]!.stdout.emit('data', 'VITE v7.1.2  ready in 800 ms\n')
    tick(120_000)
    expect(harness.stderr.join('')).toContain('suspected Vitest/Chromium tester-connection hang')
    exitChild(children[0]!, null, 'SIGTERM')
    await waitFor(() => harness.spawnCalls.length === 2)
    expect(harness.spawnCalls[1]!.env.DEBUG).toContain('pw:browser*')
    exitChild(children[1]!, 0)
    await expect(run).resolves.toBe(0)
  })

  it('treats a browser-session connection timeout as a retryable hang', async () => {
    const { children, harness, run } = setup()
    children[0]!.stdout.emit('data', 'VITE v7.1.2  ready in 800 ms\n')
    children[0]!.stderr.emit(
      'data',
      `Failed to connect to the browser session "abc" [${PROJECT_NAME} (chromium)] within the timeout.\n`,
    )
    exitChild(children[0]!, 1)
    await waitFor(() => harness.spawnCalls.length === 2)
    exitChild(children[1]!, 0)
    await expect(run).resolves.toBe(0)
    expect(harness.written[0]!.content).toContain('hang=true')
  })

  it('does not treat the browser project output marker as a stalled optimizer', async () => {
    const { children, harness, run, tick } = setup(1)
    children[0]!.stdout.emit('data', '[optimizer] scanning dependencies\n')
    children[0]!.stdout.emit('data', ` ✓ |${PROJECT_NAME}| a.stories.tsx\n`)
    tick(600_000)
    expect(harness.killed.filter((k) => k.signal === 'SIGTERM')).toHaveLength(1)
    exitChild(children[0]!, null, 'SIGTERM')
    await expect(run).resolves.toBe(1)
    expect(harness.written[0]!.content).toContain('semanticStall=true')
  })

  it('records when the completion file first appears', async () => {
    let present = false
    const { children, clock, harness, run, tick } = setup(1, () => present)
    tick(10)
    present = true
    clock.t += 5
    harness.intervals[0]!.callback()
    exitChild(children[0]!, 0)
    await run
    expect(harness.written[0]!.content).toContain('resultFileAtMs=15')
  })

  it('does not look for a completion file when none is configured', async () => {
    const child = makeChild(100)
    const harness = makeDeps([child], { exists: () => true })
    const run = runStorybookBrowserTests(
      { projectName: PROJECT_NAME },
      { env: baseEnv },
      harness.deps,
    )
    harness.intervals[0]!.callback()
    exitChild(child, 0)
    await run
    expect(harness.written[0]!.content).toContain('resultFileAtMs=none')
  })

  it('retries a Vite fetch failure when the child is killed by a signal', async () => {
    const { children, harness, run } = setup()
    children[0]!.stderr.emit('data', fetchFailure)
    exitChild(children[0]!, null, 'SIGKILL')
    await waitFor(() => harness.spawnCalls.length === 2)
    exitChild(children[1]!, 0)
    await expect(run).resolves.toBe(0)
  })
})

describe('storybook browser watchdog edge cases', () => {
  it('fails an attempt the watchdog terminated even when the command traps TERM and exits 0', async () => {
    const { children, harness, run, tick } = setup(1)
    children[0]!.stdout.emit('data', progress(1))
    tick(120_000)
    exitChild(children[0]!, 0)
    await expect(run).resolves.toBe(1)
    expect(harness.written[0]!.content).toContain('semanticStall=true')
    expect(harness.written[0]!.content).toContain('resolvedCode=1')
  })

  it('does not retry after the parent asked to terminate', async () => {
    const listeners = new Map<string, () => void>()
    const children = [makeChild(100), makeChild(101)]
    const harness = makeDeps(children)
    harness.deps.onParentSignal = (signal, listener) => void listeners.set(signal, listener)
    const run = runStorybookBrowserTests(PROJECT, { env: baseEnv }, harness.deps)
    children[0]!.stderr.emit('data', fetchFailure)
    listeners.get('SIGTERM')!()
    exitChild(children[0]!, null, 'SIGTERM')
    await expect(run).resolves.toBe(1)
    expect(harness.spawnCalls).toHaveLength(1)
    expect(harness.written[0]!.content).toContain('retryable=false')
  })

  it('terminates once and stops repeating its decision during the grace period', async () => {
    const { children, harness, run, tick } = setup(1)
    children[0]!.stdout.emit('data', progress(1))
    tick(120_000)
    tick(1000)
    tick(1000)
    expect(harness.stderr.join('').match(/no semantic test progress/g)).toHaveLength(1)
    expect(harness.killed.filter((k) => k.signal === 'SIGTERM')).toHaveLength(1)
    exitChild(children[0]!, null, 'SIGTERM')
    await run
  })

  it('never retries a mid-suite stall even after a Vite fetch failure', async () => {
    const { children, harness, run, tick } = setup()
    children[0]!.stderr.emit('data', fetchFailure)
    children[0]!.stdout.emit('data', progress(1))
    tick(120_000)
    exitChild(children[0]!, null, 'SIGTERM')
    await expect(run).resolves.toBe(1)
    expect(harness.spawnCalls).toHaveLength(1)
  })

  it('accepts fractional clock readings from a monotonic clock', async () => {
    const child = makeChild(100)
    let t = 0.4
    const harness = makeDeps([child], { now: () => (t += 0.3) })
    const run = runStorybookBrowserTests(PROJECT, { env: baseEnv }, harness.deps)
    exitChild(child, 0)
    await expect(run).resolves.toBe(0)
  })

  it('fails an attempt cancelled by the parent even when the command exits 0', async () => {
    const listeners = new Map<string, () => void>()
    const child = makeChild(100)
    const harness = makeDeps([child])
    harness.deps.onParentSignal = (signal, listener) => void listeners.set(signal, listener)
    const run = runStorybookBrowserTests(PROJECT, { env: baseEnv }, harness.deps)
    listeners.get('SIGINT')!()
    exitChild(child, 0)
    await expect(run).resolves.toBe(1)
    expect(harness.written[0]!.content).toContain('resolvedCode=1')
  })

  it('counts a progress marker that is followed by more than the rolling window of output', async () => {
    const { children, clock, harness, run, tick } = setup(1)
    children[0]!.stdout.emit('data', progress(1))
    clock.t = 100_000
    children[0]!.stdout.emit('data', progress(2) + 'x'.repeat(1350) + '\n')
    tick(119_000)
    expect(harness.killed).toEqual([])
    tick(1_000)
    expect(harness.killed.filter((k) => k.signal === 'SIGTERM')).toHaveLength(1)
    exitChild(children[0]!, null, 'SIGTERM')
    await run
    expect(harness.written[0]!.content).toContain('semanticStall=true')
  })

  it('counts a progress marker split across two chunks', async () => {
    const { children, clock, harness, run, tick } = setup(1)
    children[0]!.stdout.emit('data', progress(1))
    clock.t = 100_000
    const marker = progress(2)
    children[0]!.stdout.emit('data', marker.slice(0, 30))
    children[0]!.stdout.emit('data', marker.slice(30))
    tick(119_000)
    expect(harness.killed).toEqual([])
    tick(1_000)
    exitChild(children[0]!, null, 'SIGTERM')
    await run
  })

  it('polls at least as often as the hang timeout', async () => {
    const intervals: number[] = []
    const child = makeChild(100)
    const harness = makeDeps([child])
    harness.deps.setInterval = ((cb: () => void, ms: number) => (
      intervals.push(ms),
      harness.intervals.push({ callback: cb }),
      {}
    )) as never
    const run = runStorybookBrowserTests(
      PROJECT,
      { env: { ...baseEnv, STORYBOOK_BROWSER_HANG_MS: '1000' } },
      harness.deps,
    )
    exitChild(child, 0)
    await run
    expect(intervals).toEqual([1000])
  })

  it('samples the completion file once more when the attempt ends', async () => {
    const child = makeChild(100)
    const harness = makeDeps([child], { exists: () => true, now: () => 42 })
    const run = runStorybookBrowserTests(PROJECT, { env: baseEnv }, harness.deps)
    exitChild(child, 0)
    await run
    expect(harness.written[0]!.content).toContain('resultFileAtMs=0')
  })

  it('matches the optimizer marker when it is split across chunks and decodes split UTF-8', async () => {
    const { children, harness, run, tick } = setup(2)
    const text = Buffer.from('[optimizer] scanning dependencies ✓\n')
    children[0]!.stdout.emit('data', text.subarray(0, 20))
    children[0]!.stdout.emit('data', text.subarray(20, text.length - 2))
    children[0]!.stdout.emit('data', text.subarray(text.length - 2))
    tick(30_000)
    expect(harness.stderr.join('')).toContain('Vite optimizer made no startup progress')
    expect(harness.stdout.join('')).toContain('dependencies ✓')
    exitChild(children[0]!, null, 'SIGTERM')
    await waitFor(() => harness.spawnCalls.length === 2)
    exitChild(children[1]!, 0)
    await run
  })

  it('flushes an unterminated final line and a dangling UTF-8 byte', async () => {
    const child = makeChild(100)
    const harness = makeDeps([child])
    const run = runStorybookBrowserTests(PROJECT, { env: baseEnv }, harness.deps)
    child.stdout.emit('data', Buffer.concat([Buffer.from('last line'), Buffer.from([0xe2])]))
    child.stderr.emit('data', 'tail')
    exitChild(child, 0)
    await run
    expect(harness.stdout.join('')).toContain('last line')
    expect(harness.stderr.join('')).toContain('tail')
  })
})

describe('isSpawnedProcessGroupId', () => {
  it('accepts safe process IDs above 1 only', () => {
    expect(isSpawnedProcessGroupId(2)).toBe(true)
    expect(isSpawnedProcessGroupId(2_147_483_647)).toBe(true)
    for (const bad of [undefined, 0, 1, -5, 1.5, 2_147_483_648, Number.NaN])
      expect(isSpawnedProcessGroupId(bad)).toBe(false)
  })
})
