import { describe, expect, it } from 'vitest'

import type { Finding } from '../finding.mts'
import type { EvalCase, ExpectedFinding } from './cases.mts'
import { judgeInputs } from './judge-all.mts'
import { collectVerifierInput } from './verifier-input.mts'
import {
  buildVerifierPrompt,
  parseVerifierOutput,
  runVerifier,
  verifierArgs,
} from './verifier-run.mts'

const expected = (overrides: Partial<ExpectedFinding>): ExpectedFinding => ({
  pillar: 'design',
  severity: 'high',
  path: 'a.ts',
  lines: [1, 2],
  claim: 'c',
  ...overrides,
})

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  pillar: 'design',
  severity: 'high',
  title: 't',
  body: 'b',
  ...overrides,
})

const ITEM: EvalCase = {
  id: 'p1',
  repo: 'acme/widgets',
  pr: 1,
  title: 'T',
  baseSha: 'a',
  headSha: 'b',
  kind: 'positive',
  reason: '',
  expected: [
    expected({ pillar: 'correctness', claim: 'x' }),
    expected({ claim: 'y' }),
    expected({ claim: 'z' }),
  ],
}

function files(entries: Record<string, unknown>) {
  const store = new Map(Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]))
  return {
    readFile: (path: string) => store.get(path) as string,
    exists: (path: string) => store.has(path),
  }
}

describe('collectVerifierInput', () => {
  it('concatenates pillar findings, labels judged ones, and plants copies', () => {
    const correctness = [finding({ pillar: 'correctness', title: 'c0' })]
    const design = [finding({ title: 'd0' }), finding({ title: 'd1' })]
    const designExpected = ITEM.expected.slice(1)
    const deps = files({
      'f/raw/correctness/p1.json': {
        findings: correctness,
        judged: {
          model: 'sonnet',
          inputs: judgeInputs(ITEM.expected.slice(0, 1), correctness),
          assignment: [0],
        },
      },
      'f/raw/design/p1.json': {
        findings: design,
        judged: {
          model: 'sonnet',
          inputs: judgeInputs(designExpected, design),
          assignment: [null, 1],
        },
      },
      'f/raw/rules/p1.json': { error: 'boom' },
      'f/raw/security/p1.json': { findings: [finding({ pillar: 'security' })] },
    })
    const input = collectVerifierInput(ITEM, 'f', 'sonnet', deps)
    expect(input?.real).toEqual([
      [0, 0],
      [2, 2],
    ])
    expect(input?.planted).toEqual([
      [0, 4],
      [2, 5],
    ])
    expect(input?.findings.map((entry) => [entry.pillar, entry.title])).toEqual([
      ['correctness', 'c0'],
      ['design', 'd0'],
      ['design', 'd1'],
      ['security', 't'],
      ['design', 'c0'],
      ['correctness', 'd1'],
    ])
  })

  it('returns null when no pillar result exists', () => {
    expect(collectVerifierInput(ITEM, 'f', 'sonnet', files({}))).toBeNull()
    expect(
      collectVerifierInput(ITEM, 'f', 'sonnet', files({ 'f/raw/design/p1.json': { error: 'x' } })),
    ).toBeNull()
  })
})

describe('verifier run', () => {
  it('builds a prompt with the bench note and indexed findings', () => {
    const prompt = buildVerifierPrompt('  Verifier  ', ITEM, [finding()])
    expect(prompt.startsWith('Verifier\n\n## Benchmark run')).toBe(true)
    expect(prompt).toContain('Do not dispatch subagents')
    expect(prompt).toContain('"index": 0')
  })

  it('passes read-only tools and the schema', () => {
    const args = verifierArgs('P', 'opus', 9)
    expect(args.slice(0, 4)).toEqual(['-p', 'P', '--model', 'opus'])
    expect(args.at(-1)).toBe('9')
    expect(args).toContain('Read,Grep,Glob')
    expect(JSON.parse(args[args.indexOf('--json-schema') + 1] as string).required).toEqual([
      'summary',
      'findings',
    ])
  })

  const out = (structured: unknown) => JSON.stringify({ structured_output: structured })

  it('parses findings and their sources', () => {
    const parsed = parseVerifierOutput(
      out({ summary: ' S ', findings: [{ ...finding(), sources: [0, 1] }] }),
      2,
    )
    expect(parsed).toEqual({ summary: 'S', findings: [finding()], sources: [[0, 1]] })
  })

  it('rejects missing output and invalid sources', () => {
    expect(() => parseVerifierOutput('null', 1)).toThrow('no structured findings')
    expect(() => parseVerifierOutput(out({ findings: 'x' }), 1)).toThrow('no structured findings')
    for (const sources of [undefined, [1], [-1], [0.5], 'x']) {
      expect(() =>
        parseVerifierOutput(out({ summary: '', findings: [{ ...finding(), sources }] }), 1),
      ).toThrow('findings[0].sources must list input indexes.')
    }
    expect(() => parseVerifierOutput(out({ summary: '', findings: [null] }), 1)).toThrow(
      'findings[0].sources',
    )
  })

  it('runs claude in the snapshot directory', async () => {
    const calls: Array<string | undefined> = []
    const result = await runVerifier(
      ITEM,
      '/snap',
      [finding()],
      { verifierPrompt: 'V', model: 'opus', maxTurns: 5 },
      async (command, _args, options) => {
        calls.push(`${command} ${options?.cwd}`)
        return out({ summary: 's', findings: [] })
      },
    )
    expect(calls).toEqual(['claude /snap'])
    expect(result).toEqual({ summary: 's', findings: [], sources: [] })
  })
})
