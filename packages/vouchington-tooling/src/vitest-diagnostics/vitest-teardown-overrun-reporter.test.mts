import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TEARDOWN_OVERRUN_TAG,
  formatTeardownOverrunDiagnostics,
} from './vitest-teardown-overrun-diagnostics.mts'
import { createVitestTeardownOverrunReporter } from './vitest-teardown-overrun-reporter.mts'

describe('teardown overrun diagnostics', () => {
  afterEach(() => vi.restoreAllMocks())

  it('formats a default-tagged snapshot without failure vocabulary', () => {
    const text = formatTeardownOverrunDiagnostics()
    expect(DEFAULT_TEARDOWN_OVERRUN_TAG).toBe('[vitest-teardown-overrun]')
    expect(text).toContain('[vitest-teardown-overrun]')
    expect(text).toContain('process: ')
    expect(text).toContain('active resources: ')
    expect(text).not.toMatch(/fail|error/i)
  })

  it('accepts a custom tag', () => {
    expect(formatTeardownOverrunDiagnostics({ tag: '[custom]' })).toContain('[custom]')
  })

  it('writes diagnostics to stderr on process timeout', () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    createVitestTeardownOverrunReporter({ tag: '[t]' }).onProcessTimeout?.()
    expect(write).toHaveBeenCalledOnce()
    expect(String(write.mock.calls[0]?.[0])).toContain('[t]')
    createVitestTeardownOverrunReporter().onProcessTimeout?.()
    expect(String(write.mock.calls[1]?.[0])).toContain('[vitest-teardown-overrun]')
  })
})
