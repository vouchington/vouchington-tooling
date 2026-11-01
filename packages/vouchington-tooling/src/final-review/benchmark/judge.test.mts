import { describe, expect, it, vi } from 'vitest'

import type { Finding } from '../finding.mts'
import type { ExpectedFinding } from './cases.mts'
import { buildJudgePrompt, judgeArgs, judgeFindings, parseJudgeOutput } from './judge.mts'

const expected: ExpectedFinding[] = [
  { pillar: 'correctness', severity: 'high', path: 'a.ts', lines: [3, 4], claim: 'lock key case' },
  { pillar: 'correctness', severity: 'low', path: 'b.ts', lines: null, claim: 'index order' },
  { pillar: 'correctness', severity: 'low', path: null, lines: null, claim: 'pr level' },
]

const findings: Finding[] = [
  {
    pillar: 'correctness',
    severity: 'high',
    title: 'T0',
    body: 'x'.repeat(2000),
    path: 'a.ts',
    line: 9,
  },
  { pillar: 'correctness', severity: 'low', title: 'T1', body: 'B1', path: 'b.ts' },
  { pillar: 'correctness', severity: 'low', title: 'T2', body: 'B2' },
]

const out = (matches: unknown) => JSON.stringify({ structured_output: { matches } })

describe('buildJudgePrompt', () => {
  it('lists claims and findings with locations and truncated bodies', () => {
    const prompt = buildJudgePrompt(expected, findings)
    expect(prompt).toContain('[E0] a.ts:3\nlock key case')
    expect(prompt).toContain('[E1] b.ts\nindex order')
    expect(prompt).toContain('[E2] (pull request level)\npr level')
    expect(prompt).toContain('[F0] high a.ts:9\nT0')
    expect(prompt).toContain('[F1] low b.ts\nT1\nB1')
    expect(prompt).toContain('[F2] low (pull request level)\nT2')
    expect(prompt).not.toContain('x'.repeat(1201))
  })
})

describe('judgeArgs', () => {
  it('disables tools and requests structured output', () => {
    const args = judgeArgs('P', 'sonnet')
    expect(args.slice(0, 4)).toEqual(['-p', 'P', '--model', 'sonnet'])
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args).toContain('--json-schema')
  })
})

describe('parseJudgeOutput', () => {
  it('builds an assignment and drops invalid or reused matches', () => {
    const matches = [
      { expected: 0, finding: 1 },
      { expected: 0, finding: 2 },
      { expected: 1, finding: 1 },
      { expected: 2, finding: 7 },
      { expected: 9, finding: 0 },
      { expected: 'x', finding: 0 },
      { expected: 1, finding: null },
    ]
    expect(parseJudgeOutput(out(matches), 3, 3)).toEqual([1, null, null])
  })

  it('rejects output without matches', () => {
    expect(() => parseJudgeOutput('{}', 1, 1)).toThrow('no structured matches')
    expect(() => parseJudgeOutput('null', 1, 1)).toThrow('no structured matches')
  })
})

describe('judgeFindings', () => {
  it('skips the model when there is nothing to match', async () => {
    const exec = vi.fn()
    await expect(judgeFindings(expected, [], 'm', exec)).resolves.toEqual([null, null, null])
    await expect(judgeFindings([], findings, 'm', exec)).resolves.toEqual([])
    expect(exec).not.toHaveBeenCalled()
  })

  it('runs claude without a working directory and parses the result', async () => {
    const exec = vi.fn(async () => out([{ expected: 1, finding: 0 }]))
    await expect(judgeFindings(expected, findings, 'm', exec)).resolves.toEqual([null, 0, null])
    expect(exec).toHaveBeenCalledWith('claude', expect.arrayContaining(['--model', 'm']))
  })
})
