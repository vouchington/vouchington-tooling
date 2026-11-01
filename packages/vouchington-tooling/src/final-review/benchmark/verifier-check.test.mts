import { describe, expect, it } from 'vitest'

import type { Finding } from '../finding.mts'
import { buildCheckPrompt, checkArgs, checkFindings, parseChecks } from './verifier-check.mts'

const finding = (title: string): Finding => ({
  pillar: 'design',
  severity: 'high',
  title,
  body: 'b',
})

const out = (verdicts: unknown) => JSON.stringify({ structured_output: { verdicts } })

describe('verifier check', () => {
  it('lists only the requested findings with their output index', () => {
    const prompt = buildCheckPrompt([finding('a'), finding('b')], [1])
    expect(prompt).toContain('"index": 1')
    expect(prompt).toContain('"title": "b"')
    expect(prompt).not.toContain('"title": "a"')
  })

  it('passes read-only tools and the schema', () => {
    const args = checkArgs('P', 'opus', 7)
    expect(args.slice(0, 4)).toEqual(['-p', 'P', '--model', 'opus'])
    expect(args.at(-1)).toBe('7')
    expect(JSON.parse(args[args.indexOf('--json-schema') + 1] as string).required).toEqual([
      'verdicts',
    ])
  })

  it('keeps the first verdict per listed index', () => {
    const checks = parseChecks(
      out([
        { index: 1, holds: false, reason: 'no' },
        { index: 1, holds: true, reason: 'dup' },
        { index: 9, holds: true, reason: 'unlisted' },
      ]),
      [1, 2],
    )
    expect([...checks]).toEqual([[1, { holds: false, reason: 'no' }]])
    expect(() => parseChecks('null', [1])).toThrow('no verdicts')
    expect(() => parseChecks(out('x'), [1])).toThrow('no verdicts')
  })

  it('skips the call with nothing to check and runs in the snapshot otherwise', async () => {
    const cwds: Array<string | undefined> = []
    const exec = async (_command: string, _args: string[], options?: { cwd?: string }) => {
      cwds.push(options?.cwd)
      return out([{ index: 0, holds: true, reason: 'yes' }])
    }
    const run = { model: 'opus', maxTurns: 3 }
    expect((await checkFindings('/snap', [finding('a')], [], run, exec)).size).toBe(0)
    expect(cwds).toEqual([])
    const checks = await checkFindings('/snap', [finding('a')], [0], run, exec)
    expect(checks.get(0)).toEqual({ holds: true, reason: 'yes' })
    expect(cwds).toEqual(['/snap'])
  })
})
