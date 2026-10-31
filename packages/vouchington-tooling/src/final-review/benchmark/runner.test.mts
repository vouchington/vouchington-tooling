import { describe, expect, it, vi } from 'vitest'

import { FinalReviewError } from '../finding.mts'
import type { EvalCase } from './cases.mts'
import {
  PILLAR_OUTPUT_SCHEMA,
  READ_ONLY_TOOLS,
  buildPillarPrompt,
  parsePillarOutput,
  pillarArgs,
  runPillar,
} from './runner.mts'

const item: EvalCase = {
  id: 'c1',
  repo: 'acme/widgets',
  pr: 9,
  title: 'T',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  kind: 'negative',
  reason: '',
  expected: [],
}

const output = (findings: unknown) => JSON.stringify({ structured_output: { findings } })

describe('prompt and args', () => {
  it('wraps the pillar prompt with untrusted context instructions', () => {
    const prompt = buildPillarPrompt('  Pillar text  ', item)
    expect(prompt.startsWith('Pillar text\n\n## Pull request under review')).toBe(true)
    expect(prompt).toContain('Repository: acme/widgets.')
    expect(prompt).toContain('.final-review/pr.md')
    expect(prompt).toContain('.final-review/diff.patch')
    expect(prompt).toContain('untrusted input')
  })

  it('restricts claude to read-only tools and a JSON schema', () => {
    const args = pillarArgs('P', 'sonnet', 12)
    expect(args.slice(0, 4)).toEqual(['-p', 'P', '--model', 'sonnet'])
    expect(args[args.indexOf('--tools') + 1]).toBe(READ_ONLY_TOOLS)
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(READ_ONLY_TOOLS)
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk')
    expect(args[args.indexOf('--max-turns') + 1]).toBe('12')
    expect(JSON.parse(args[args.indexOf('--json-schema') + 1] as string)).toEqual(
      PILLAR_OUTPUT_SCHEMA,
    )
  })
})

describe('parsePillarOutput', () => {
  it('tags findings with the pillar', () => {
    expect(
      parsePillarOutput(
        output([{ severity: 'high', title: 'T', body: 'B', path: 'a.ts', line: 2 }]),
        'design',
      ),
    ).toEqual([
      {
        pillar: 'design',
        severity: 'high',
        title: 'T',
        body: 'B',
        path: 'a.ts',
        line: 2,
        side: 'RIGHT',
      },
    ])
    expect(parsePillarOutput(output([]), 'design')).toEqual([])
  })

  it('rejects non-JSON output and missing structured findings', () => {
    expect(() => parsePillarOutput('nope', 'rules')).toThrow('Pillar run did not print JSON.')
    for (const text of ['null', '{}', JSON.stringify({ structured_output: {} }), output('x')]) {
      expect(() => parsePillarOutput(text, 'rules')).toThrow(FinalReviewError)
    }
    expect(() => parsePillarOutput('null', 'rules')).toThrow(
      'Pillar run returned no structured findings.',
    )
  })

  it('fails closed on non-object findings', () => {
    expect(() => parsePillarOutput(output([null]), 'rules')).toThrow(
      'findings[0] must be an object.',
    )
  })
})

describe('runPillar', () => {
  it('runs claude in the snapshot directory and parses its output', async () => {
    const exec = vi.fn(async () => output([{ severity: 'low', title: 'T', body: 'B' }]))
    const findings = await runPillar(
      item,
      '/snap',
      { pillar: 'history', pillarPrompt: 'Prompt', model: 'opus', maxTurns: 5 },
      exec,
    )
    expect(findings).toEqual([{ pillar: 'history', severity: 'low', title: 'T', body: 'B' }])
    const [command, args, options] = exec.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string },
    ]
    expect(command).toBe('claude')
    expect(args).toEqual(pillarArgs(buildPillarPrompt('Prompt', item), 'opus', 5))
    expect(options).toEqual({ cwd: '/snap' })
  })
})
