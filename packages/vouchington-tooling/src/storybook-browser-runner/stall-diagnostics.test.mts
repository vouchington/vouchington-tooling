import { describe, expect, it } from 'vitest'

import { StorybookBrowserBootstrapTelemetry } from './bootstrap-telemetry.mts'
import {
  PROJECT,
  exitChild,
  makeChild,
  makeDeps,
  progress,
  type FakeOptions,
} from './fixtures.test-helpers.mts'
import { runStorybookBrowserTests } from './index.mts'
import { progressMarkerLine } from './output-patterns.mts'

const baseEnv = { CI: '', RUNNER_TEMP: '', STORYBOOK_BROWSER_STARTUP_ATTEMPTS: '2' }

function setup(options: FakeOptions = {}) {
  const clock = { t: 0 }
  const child = makeChild(321)
  const harness = makeDeps([child], { ...options, now: () => clock.t })
  const run = runStorybookBrowserTests(PROJECT, { env: baseEnv }, harness.deps)
  const tick = (ms: number) => {
    clock.t += ms
    harness.intervals[0]!.callback()
  }
  return { child, clock, harness, run, tick }
}

describe('stall process-group diagnostics', () => {
  it('samples the process group before terminating a semantic stall', async () => {
    const { child, harness, run, tick } = setup()
    child.stdout.emit('data', progress(7))
    tick(120_000)
    expect(harness.events.slice(0, 2)).toEqual(['sample:321', 'kill:SIGTERM'])
    const log = harness.stderr.join('')
    expect(log).toContain(
      '[storybook-browser] process group 321 at stall:\n  processes=1 (fake 321)\n',
    )
    expect(log).toContain(
      'no semantic test progress for 120000ms; terminating terminal mid-suite stall (last progress 120000ms ago: [vitest-browser-progress] seq=7 event=module-start module="a.stories.tsx")',
    )
    exitChild(child, null, 'SIGTERM')
    await run
  })

  it('completes a progress marker split across chunks', async () => {
    const { child, harness, run, tick } = setup()
    child.stdout.emit('data', '[vitest-browser-progress] seq=7 event=module-start')
    child.stdout.emit('data', ' module="a.stories.tsx"\n')
    child.stdout.emit('data', `${'x'.repeat(700)}\n`)
    tick(120_000)
    expect(harness.stderr.join('')).toContain('seq=7 event=module-start module="a.stories.tsx")')
    exitChild(child, null, 'SIGTERM')
    await run
  })

  it('names a missing marker line when progress came from project output only', async () => {
    const { child, harness, run, tick } = setup()
    child.stdout.emit('data', 'x |browser-suite y\n')
    tick(120_000)
    expect(harness.stderr.join('')).toContain('ago: no marker line)')
    exitChild(child, null, 'SIGTERM')
    await run
  })

  it('samples the process group before terminating a tester-connection hang', async () => {
    const { child, harness, run, tick } = setup()
    child.stdout.emit('data', 'VITE v7.1.2  ready in 800 ms\n')
    tick(120_000)
    expect(harness.events.slice(0, 2)).toEqual(['sample:321', 'kill:SIGTERM'])
    expect(harness.stderr.join('')).toContain('process group 321 at stall:')
    exitChild(child, null, 'SIGTERM')
    await run.catch(() => undefined)
  })

  it('samples before terminating an optimizer stall', async () => {
    const { child, harness, run, tick } = setup()
    child.stdout.emit('data', '[optimizer] scanning dependencies\n')
    tick(30_000)
    expect(harness.events.slice(0, 2)).toEqual(['sample:321', 'kill:SIGTERM'])
    exitChild(child, null, 'SIGTERM')
    await run.catch(() => undefined)
  })

  it('still terminates when the sampler throws', async () => {
    const { child, harness, run, tick } = setup({
      sampleProcessGroup: () => {
        throw new Error('ps unavailable')
      },
    })
    child.stdout.emit('data', progress(1))
    tick(120_000)
    expect(harness.killed[0]).toEqual({ pid: 321, signal: 'SIGTERM' })
    expect(harness.stderr.join('')).toContain(
      '[storybook-browser] process group 321 sample failed: ps unavailable\n',
    )
    exitChild(child, null, 'SIGTERM')
    await run
  })

  it('extracts the bounded marker line for a sequence', () => {
    const text = 'a seq=1 \n[p] seq=2 event=module-end module="m"\nrest'
    expect(progressMarkerLine(text, '[p]', 2)).toBe('[p] seq=2 event=module-end module="m"')
    expect(progressMarkerLine('[p] seq=3 tail', '[p]', 3)).toBe('[p] seq=3 tail')
    expect(progressMarkerLine('nothing', '[p]', 3)).toBeNull()
    expect(progressMarkerLine(`[p] seq=3 ${'x'.repeat(900)}`, '[p]', 3)).toHaveLength(512)
  })
})

describe('Playwright crash evidence', () => {
  const crashed = 'pw:protocol <← RECV {"method":"Target.targetCrashed","params":{}}\n'
  const inspector = 'pw:protocol <- RECV {"method":"Inspector.targetCrashed","params":{}}\n'
  const detached = 'pw:protocol <- RECV {"method":"Target.detachedFromTarget","params":{}}\n'
  const noise = 'pw:protocol SEND {"method":"Page.enable","id":4}\n'

  it('keeps and counts crash and detach lines but drops other protocol lines', () => {
    const telemetry = new StorybookBrowserBootstrapTelemetry()
    const result = telemetry.consume('stderr', crashed + noise + inspector + detached, 3)
    expect(result.output).toBe(crashed + inspector + detached)
    expect(result.hasNonDiagnosticOutput).toBe(false)
    expect(telemetry.snapshot()).toMatchObject({ targetCrashCount: 2, targetDetachCount: 1 })
  })

  it('reports zero counts without protocol evidence', () => {
    const snapshot = new StorybookBrowserBootstrapTelemetry().snapshot()
    expect(snapshot.targetCrashCount).toBe(0)
    expect(snapshot.targetDetachCount).toBe(0)
  })

  it('prints the counts in the attempt summary', async () => {
    const child = makeChild(100)
    const harness = makeDeps([child])
    const run = runStorybookBrowserTests(PROJECT, { env: baseEnv }, harness.deps)
    child.stderr.emit('data', crashed + detached)
    exitChild(child, 0)
    await run
    expect(harness.written[0]!.content).toContain('targetCrashCount=1; targetDetachCount=1;')
  })
})
