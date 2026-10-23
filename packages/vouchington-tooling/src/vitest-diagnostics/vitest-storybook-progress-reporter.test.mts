import { describe, expect, it, vi } from 'vitest'
import type { TestModule } from 'vitest/node'
import {
  DEFAULT_STORYBOOK_PROGRESS_PREFIX,
  createVitestStorybookProgressReporter,
  formatStorybookProgressMarker,
  latestStorybookProgressSequence,
} from './vitest-storybook-progress-reporter.mts'

const mod = { moduleId: '/abs/a.mts', relativeModuleId: 'a.mts' } as TestModule

describe('storybook progress reporter', () => {
  it('numbers markers and resets on a new run', () => {
    const lines: string[] = []
    const reporter = createVitestStorybookProgressReporter({ write: (c) => void lines.push(c) })
    reporter.onTestModuleCollected(mod)
    reporter.onTestModuleStart(mod)
    reporter.onTestModuleEnd(mod)
    reporter.onTestRunStart()
    reporter.onTestModuleStart({ moduleId: '/abs/b.mts', relativeModuleId: '' } as TestModule)
    expect(lines.map((l) => l.match(/seq=(\d+) event=(\S+)/)!.slice(1))).toEqual([
      ['1', 'module-collected'],
      ['2', 'module-start'],
      ['3', 'module-end'],
      ['1', 'module-start'],
    ])
    expect(lines[3]).toContain('module="/abs/b.mts"')
    expect(lines[0]!.startsWith(DEFAULT_STORYBOOK_PROGRESS_PREFIX)).toBe(true)
  })

  it('writes to stdout by default and honors a custom prefix', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    try {
      createVitestStorybookProgressReporter({ prefix: '[sb]' }).onTestModuleStart(mod)
      expect(write).toHaveBeenCalledWith('[sb] seq=1 event=module-start module="a.mts"\n')
    } finally {
      write.mockRestore()
    }
  })

  it('keeps markers within the byte budget', () => {
    const marker = formatStorybookProgressMarker(7, 'module-end', 'é'.repeat(400))
    expect(Buffer.byteLength(marker)).toBeLessThanOrEqual(512)
    expect(marker).toContain('…')
    const huge = formatStorybookProgressMarker(1, 'module-end', 'x', 'p'.repeat(600))
    expect(huge.endsWith('module=""\n')).toBe(true)
  })

  it('reads the latest sequence back for the matching prefix only', () => {
    const text = [
      formatStorybookProgressMarker(2, 'module-start', 'a', '[a.b]'),
      formatStorybookProgressMarker(9, 'module-end', 'a', '[a.b]'),
      formatStorybookProgressMarker(4, 'module-end', 'a', '[a.b]'),
      formatStorybookProgressMarker(99, 'module-end', 'a', '[axb]'),
      `[a.b] seq=${'9'.repeat(30)} event=module-end`,
    ].join('')
    expect(latestStorybookProgressSequence(text, '[a.b]')).toBe(9)
    expect(latestStorybookProgressSequence(text)).toBeNull()
    expect(
      latestStorybookProgressSequence(formatStorybookProgressMarker(3, 'module-end', 'z')),
    ).toBe(3)
  })
})
