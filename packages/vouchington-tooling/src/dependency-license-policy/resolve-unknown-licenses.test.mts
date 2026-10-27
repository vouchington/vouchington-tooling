import { describe, expect, it } from 'vitest'

import { resolveUnknownLicenses } from './resolve-unknown-licenses.mts'
import type { PnpmCommandResult, PnpmExecutor, PnpmLicenseReport } from './types.mts'

const OPTIONS = { cwd: '/audit', encoding: 'utf8' as const, signal: new AbortController().signal }

function reportOf(groups: Record<string, PnpmLicenseReport[string]>): PnpmLicenseReport {
  return Object.assign(Object.create(null) as PnpmLicenseReport, groups)
}

function viewer(outputs: Record<string, PnpmCommandResult | string>): {
  calls: string[]
  execute: PnpmExecutor
} {
  const calls: string[] = []
  const execute: PnpmExecutor = (command, args, options) => {
    expect(command).toBe('pnpm')
    expect(args.slice(0, 1)).toEqual(['view'])
    expect(args.slice(2)).toEqual(['license', '--json'])
    expect(options).toBe(OPTIONS)
    const spec = args[1] ?? ''
    calls.push(spec)
    const output = outputs[spec]
    if (output === undefined) throw new Error(`unexpected view ${spec}`)
    if (typeof output !== 'string') return output
    return { status: 0, stderr: '', stdout: output }
  }
  return { calls, execute }
}

describe('resolveUnknownLicenses', () => {
  it('returns a report without Unknown entries untouched', async () => {
    const report = reportOf({ MIT: [{ name: 'a', versions: ['1.0.0'] }] })
    const { calls, execute } = viewer({})
    await expect(resolveUnknownLicenses(report, execute, OPTIONS)).resolves.toBe(report)
    expect(calls).toEqual([])
  })

  it('moves resolved entries into license groups and drops an emptied Unknown key', async () => {
    const report = reportOf({
      MIT: [{ name: 'a', versions: ['1.0.0'] }],
      Unknown: [
        { name: 'a', versions: ['2.0.0'] },
        { name: '@s/b', versions: ['1.0.0', '1.1.0'] },
        { name: 'c', versions: ['3.0.0'] },
      ],
    })
    const { calls, execute } = viewer({
      'a@2.0.0': '"MIT"\n',
      '@s/b@1.0.0': '{"type":"Apache-2.0","url":"x"}',
      '@s/b@1.1.0': '"Apache-2.0"',
      'c@3.0.0': '"ISC"',
    })
    const resolved = await resolveUnknownLicenses(report, execute, OPTIONS)
    expect(calls.toSorted()).toEqual(['@s/b@1.0.0', '@s/b@1.1.0', 'a@2.0.0', 'c@3.0.0'])
    expect(Object.getPrototypeOf(resolved)).toBeNull()
    expect(resolved).toEqual({
      'Apache-2.0': [{ name: '@s/b', versions: ['1.0.0', '1.1.0'] }],
      ISC: [{ name: 'c', versions: ['3.0.0'] }],
      MIT: [{ name: 'a', versions: ['1.0.0', '2.0.0'] }],
    })
    expect('Unknown' in resolved).toBe(false)
  })

  it('merges into an existing entry that has no versions', async () => {
    const report = reportOf({
      MIT: [{ name: 'a' }],
      Unknown: [{ name: 'a', versions: ['2.0.0'] }],
    })
    const { execute } = viewer({ 'a@2.0.0': '"MIT"' })
    const resolved = await resolveUnknownLicenses(report, execute, OPTIONS)
    expect(resolved).toEqual({ MIT: [{ name: 'a', versions: ['2.0.0'] }] })
  })

  it.each([
    ['empty output', ''],
    ['an object without a type', '{"url":"x"}'],
    ['an object with a non-string type', '{"type":1}'],
    ['an array', '["MIT"]'],
    ['a number', '3'],
    ['a blank string', '"  "'],
    ['a literal Unknown', '"Unknown"'],
    ['an object with a literal Unknown type', '{"type":"Unknown"}'],
  ])('keeps an entry Unknown for %s', async (_label, stdout) => {
    const report = reportOf({
      Unknown: [
        { name: 'a', versions: ['1.0.0', '2.0.0'] },
        { name: 'bare' },
        { name: 'none', versions: [] },
      ],
    })
    const { execute } = viewer({
      'a@1.0.0': stdout,
      'a@2.0.0': '"MIT"',
    })
    const resolved = await resolveUnknownLicenses(report, execute, OPTIONS)
    expect(resolved).toEqual({
      MIT: [{ name: 'a', versions: ['2.0.0'] }],
      Unknown: [
        { name: 'a', versions: ['1.0.0'] },
        { name: 'bare' },
        { name: 'none', versions: [] },
      ],
    })
  })

  it('never runs more than eight views at once', async () => {
    const versions = Array.from({ length: 30 }, (_, index) => `1.0.${String(index)}`)
    const report = reportOf({ Unknown: [{ name: 'a', versions }] })
    let active = 0
    let peak = 0
    const execute: PnpmExecutor = async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setImmediate(resolve))
      active -= 1
      return { status: 0, stderr: '', stdout: '"MIT"' }
    }
    const resolved = await resolveUnknownLicenses(report, execute, OPTIONS)
    expect(peak).toBe(8)
    expect(resolved.MIT?.[0]?.versions).toHaveLength(30)
  })

  it.each([
    [
      { status: 1, stderr: 'E404', stdout: '' },
      /pnpm view a@1\.0\.0 license --json exited with status 1: E404/,
    ],
    [{ error: new Error('spawn failed'), status: null, stderr: '', stdout: '' }, /spawn failed/],
    [{ status: 0, stderr: '', stdout: '{oops' }, /produced unparseable output/],
  ])('fails on a bad view result', async (result, message) => {
    const report = reportOf({ Unknown: [{ name: 'a', versions: ['1.0.0', '1.0.1'] }] })
    const { execute } = viewer({
      'a@1.0.0': result,
      'a@1.0.1': '"MIT"',
    })
    await expect(resolveUnknownLicenses(report, execute, OPTIONS)).rejects.toThrow(message)
  })
})
