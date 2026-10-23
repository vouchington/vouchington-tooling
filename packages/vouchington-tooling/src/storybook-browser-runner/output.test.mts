import { describe, expect, it } from 'vitest'

import { StorybookBrowserBootstrapTelemetry } from './bootstrap-telemetry.mts'
import { StorybookBrowserDiagnostics } from './diagnostics.mts'
import { createProjectOutputPatterns, hasAddonVitestSetupFile } from './output-patterns.mts'
import { MAX_QUIET_TAIL_BYTES, StorybookQuietOutput, quietOutputHeader } from './quiet-output.mts'
import {
  hasStorybookBrowserViteReady,
  hasStorybookViteNewDependenciesFound,
  hasStorybookViteOptimizerReload,
  parseStorybookViteNewDependencies,
  stripAnsi,
} from './vite-detectors.mts'

describe('vite detectors', () => {
  it('strips ANSI and recognises the optimizer lifecycle', () => {
    expect(stripAnsi('\u001B[31mred\u001B[0m')).toBe('red')
    expect(hasStorybookBrowserViteReady('dependencies optimized')).toBe(true)
    expect(hasStorybookBrowserViteReady('Hash is consistent')).toBe(true)
    expect(hasStorybookBrowserViteReady('VITE v7.1.2  ready in 800 ms')).toBe(true)
    expect(hasStorybookBrowserViteReady('nothing')).toBe(false)
    expect(hasStorybookViteNewDependenciesFound('new dependencies found: a')).toBe(true)
    expect(hasStorybookViteOptimizerReload('optimized dependencies changed. reloading')).toBe(true)
  })

  it('lists unique new dependencies', () => {
    expect(
      parseStorybookViteNewDependencies(
        'new dependencies found: a, b,,\nnew dependencies found: b, c',
      ),
    ).toEqual(['a', 'b', 'c'])
    expect(parseStorybookViteNewDependencies('none')).toEqual([])
  })
})

describe('createProjectOutputPatterns', () => {
  it('builds the project-specific matchers and escapes the name', () => {
    const patterns = createProjectOutputPatterns('ui (a+b)')
    expect(patterns.projectMarker).toBe('|ui (a+b)')
    expect(patterns.testOutput.test('x |ui (a+b)| y')).toBe(true)
    expect(patterns.testOutput.test('\n  ✓ Test Files  3')).toBe(true)
    expect(patterns.testOutput.test('ui (aab)')).toBe(false)
    expect(
      patterns.connectionTimeout.test(
        'Failed to connect to the browser session "s1" [ui (a+b) (chromium)] within the timeout.',
      ),
    ).toBe(true)
  })

  it('latches the add-on setup file markers from the chunk or the buffer', () => {
    const path = '/@storybook/addon-vitest/dist/vitest-plugin/setup-file.js'
    expect(hasAddonVitestSetupFile(path, '')).toBe(true)
    expect(hasAddonVitestSetupFile('', path)).toBe(true)
    expect(
      hasAddonVitestSetupFile('/@storybook/addon-vitest/', '/vitest-plugin/setup-file.js'),
    ).toBe(false)
  })
})

describe('StorybookQuietOutput', () => {
  const prefix = '[vitest-browser-progress]'
  const marker = `${prefix} seq=1 event=module-start module="a"\n`

  it('retains progress markers and vite:deps debug blocks, keeping lifecycle lines visible', () => {
    const quiet = new StorybookQuietOutput(prefix)
    const visible = quiet.split(
      [
        'hello\n',
        marker,
        '  vite:deps scanning\n',
        '    /deps/a.js\n',
        'plain\n',
        '  vite:deps dependencies optimized\n',
        'vite:deps new dependencies found: a\n',
        'vite:deps optimized dependencies changed. reloading\n',
      ].join(''),
      'stdout',
    )
    expect(visible).toBe(
      'hello\nplain\n  vite:deps dependencies optimized\nvite:deps new dependencies found: a\nvite:deps optimized dependencies changed. reloading\n',
    )
    const drained = quiet.drain()
    expect(drained).toContain(marker)
    expect(drained).toContain('/deps/a.js')
    expect(quiet.drain()).toBe('')
    expect(quietOutputHeader(12)).toContain('last 12 bytes')
  })

  it('tracks the debug block per stream', () => {
    const quiet = new StorybookQuietOutput(prefix)
    quiet.split('vite:deps x\n', 'stderr')
    expect(quiet.split('    /a\n', 'stdout')).toBe('    /a\n')
    expect(quiet.split('    /b\n', 'stderr')).toBe('')
  })

  it('splits CR-only line endings', () => {
    const quiet = new StorybookQuietOutput(prefix)
    expect(quiet.split(`a\r${marker}b\r\n`, 'stdout')).toBe('a\rb\r\n')
  })

  it('keeps only the newest bytes within the tail budget', () => {
    const quiet = new StorybookQuietOutput(prefix)
    const line = `${prefix} ${'x'.repeat(60 * 1024)}\n`
    quiet.split(line + line + line, 'stdout')
    const drained = quiet.drain()
    expect(Buffer.byteLength(drained)).toBe(MAX_QUIET_TAIL_BYTES)
    expect(drained.endsWith('\n')).toBe(true)
    quiet.split(`${prefix} ${'y'.repeat(MAX_QUIET_TAIL_BYTES * 2)}\n`, 'stdout')
    expect(Buffer.byteLength(quiet.drain())).toBe(MAX_QUIET_TAIL_BYTES)
  })

  it('drops whole chunks when the excess covers the oldest one', () => {
    const quiet = new StorybookQuietOutput(prefix)
    const line = (size: number, fill: string) =>
      `${prefix} ${fill.repeat(size - prefix.length - 2)}\n`
    quiet.split(line(100, 'a'), 'stdout')
    quiet.split(line(MAX_QUIET_TAIL_BYTES, 'b'), 'stdout')
    expect(quiet.drain()).toBe(line(MAX_QUIET_TAIL_BYTES, 'b'))
  })
})

describe('StorybookBrowserDiagnostics', () => {
  it('renders attempt summaries and the output tail', () => {
    const diagnostics = new StorybookBrowserDiagnostics()
    diagnostics.recordAttempt('one\n')
    diagnostics.recordOutput('out')
    diagnostics.recordOutput(Buffer.from('put'))
    expect(diagnostics.render().toString()).toBe(
      '[storybook-browser-diagnostics]\none\noutput tail:\noutput',
    )
  })

  it('truncates the tail and marks the truncation', () => {
    const diagnostics = new StorybookBrowserDiagnostics()
    diagnostics.recordOutput('a'.repeat(2 * 1024 * 1024))
    const rendered = diagnostics.render()
    expect(rendered.byteLength).toBeLessThanOrEqual(1024 * 1024)
    expect(rendered.toString()).toContain('[diagnostic output truncated]')
    const smaller = new StorybookBrowserDiagnostics()
    smaller.recordOutput('b'.repeat(1024 * 1024))
    smaller.recordAttempt('s'.repeat(100 * 1024))
    expect(smaller.render().byteLength).toBe(1024 * 1024)
  })
})

describe('StorybookBrowserBootstrapTelemetry', () => {
  it('records the provider milestones in order and the furthest stage', () => {
    const telemetry = new StorybookBrowserBootstrapTelemetry()
    expect(telemetry.snapshot().terminalStage).toBe('no-provider-evidence')
    const lines = [
      'vitest:browser:playwright initializing the browser\n',
      'vitest:browser:playwright the context is ready\n',
      'vitest:browser:playwright the page is ready\n',
      'vitest:browser:playwright browser page is created, opening http://x\n',
      'vitest:browser:api Browser API connected to orchestrator\n',
      'vitest:browser:api Browser API disconnected from orchestrator\n',
      'vitest:browser:api noisy\n',
      'pw:protocol SEND\n',
      'visible\n',
    ]
    const result = telemetry.consume('stdout', lines.join(''), 5)
    expect(result.hasNonDiagnosticOutput).toBe(true)
    expect(result.output).toContain('Browser API connected')
    expect(result.output).not.toContain('noisy')
    expect(result.output).not.toContain('pw:protocol')
    const snapshot = telemetry.snapshot()
    expect(snapshot.terminalStage).toBe('handshake-after-websocket')
    expect(snapshot.orchestratorDisconnectCount).toBe(1)
    expect(snapshot.timeline.map((e) => e.milestone)).toEqual([
      'provider-started',
      'context-ready',
      'page-ready',
      'navigation-requested',
      'orchestrator-connected',
    ])
    telemetry.recordSemanticProgress(9)
    telemetry.recordSemanticProgress(10)
    expect(telemetry.snapshot().terminalStage).toBe('semantic-progress')
    expect(
      telemetry.snapshot().timeline.filter((e) => e.milestone === 'semantic-progress'),
    ).toHaveLength(1)
  })

  it('caps request-failure samples and diagnostic lines', () => {
    const telemetry = new StorybookBrowserBootstrapTelemetry()
    const failures = Array.from({ length: 25 }, (_, i) => `[PW Error] request ${i}\n`).join('')
    const output = telemetry.consume('stderr', failures, 0).output
    expect(output.match(/\[PW Error\]/g)).toHaveLength(20)
    expect(output).toContain('suppressed additional request-failure diagnostic lines')
    const snapshot = telemetry.snapshot()
    expect(snapshot.requestFailureCount).toBe(25)
    expect(snapshot.requestFailureSamples).toHaveLength(5)
    const browser = Array.from({ length: 203 }, (_, i) => `pw:browser line ${i}\n`).join('')
    const browserOutput = telemetry.consume('stdout', browser, 0).output
    expect(browserOutput.match(/^pw:browser line/gm)).toHaveLength(200)
    expect(browserOutput).toContain('suppressed additional pw:browser lines')
  })

  it('buffers partial lines, flushes them, and keeps blank lines', () => {
    const telemetry = new StorybookBrowserBootstrapTelemetry()
    expect(telemetry.consume('stdout', 'par', 0)).toEqual({
      hasNonDiagnosticOutput: false,
      output: '',
    })
    expect(telemetry.consume('stdout', 'tial\n\n', 0)).toEqual({
      hasNonDiagnosticOutput: true,
      output: 'partial\n\n',
    })
    telemetry.consume('stderr', 'tail', 0)
    expect(telemetry.flush('stderr', 1).output).toBe('tail')
    expect(telemetry.flush('stderr', 1)).toEqual({ hasNonDiagnosticOutput: false, output: '' })
  })
})
