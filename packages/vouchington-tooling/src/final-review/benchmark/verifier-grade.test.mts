import { describe, expect, it } from 'vitest'

import type { Finding } from '../finding.mts'
import type { EvalCase } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import { gradeAll, gradeInputs, type VerifierRaw } from './verifier-grade.mts'

const finding = (severity: Finding['severity'], title = 't'): Finding => ({
  pillar: 'design',
  severity,
  title,
  body: 'b',
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
  expected: [{ pillar: 'design', severity: 'high', path: null, lines: null, claim: 'c' }],
}

const OPTIONS = {
  findingsFrom: 'f',
  out: 'o',
  judge: 'sonnet',
  checker: 'opus',
  maxTurns: 5,
  jobs: 1,
}

function harness(raws: Record<string, VerifierRaw>, exec: BenchDeps['exec']) {
  const store = new Map(
    Object.entries(raws).map(([id, raw]) => [`o/raw/${id}.json`, JSON.stringify(raw)]),
  )
  const logs: string[] = []
  const prepared: string[] = []
  const deps: BenchDeps = {
    exec,
    readFile: (path) => store.get(path) as string,
    writeFile: (path, text) => void store.set(path, text),
    exists: (path) => store.has(path),
    log: (line) => void logs.push(line),
    prepare: async (item) => {
      prepared.push(item.id)
      return { dir: `/snap/${item.id}`, diff: '', body: '' }
    },
  }
  return { deps, store, logs, prepared }
}

const input = { findings: [finding('high')], real: [], planted: [] }

describe('gradeAll', () => {
  it('judges added findings, then checks uncredited blocking and high findings', async () => {
    // Output 0 confirms a noise input, output 1 is added and raises the label, output 2 is added noise.
    const output = {
      summary: '',
      findings: [finding('high'), finding('blocking', 'label'), finding('high', 'noise')],
      sources: [[0], [], []],
    }
    const calls: string[] = []
    const h = harness({ p1: { input, inputs: 'run', output } }, async (_command, args, options) => {
      const prompt = args[1] as string
      if (options?.cwd === undefined) {
        calls.push('judge')
        return JSON.stringify({ structured_output: { matches: [{ expected: 0, finding: 0 }] } })
      }
      calls.push(`check ${prompt.includes('"index": 2')} ${prompt.includes('"index": 0')}`)
      return JSON.stringify({
        structured_output: { verdicts: [{ index: 2, holds: false, reason: 'wrong' }] },
      })
    })
    await gradeAll([ITEM], OPTIONS, h.deps)
    expect(calls).toEqual(['judge', 'check true true'])
    const graded = JSON.parse(h.store.get('o/raw/p1.json') as string).graded
    expect(graded).toEqual({
      judge: 'sonnet',
      checker: 'opus',
      inputs: gradeInputs(ITEM, output, ['sonnet', 'opus']),
      added: [0],
      checks: [null, null, { holds: false, reason: 'wrong' }],
    })
    // A current grade is reused.
    calls.length = 0
    await gradeAll([ITEM], OPTIONS, h.deps)
    expect(calls).toEqual([])
  })

  it('skips missing and failed runs, avoids snapshots with nothing to check, and logs failures', async () => {
    const quiet = { summary: '', findings: [finding('low')], sources: [[0]] }
    const strong = { summary: '', findings: [finding('high')], sources: [[]] }
    const other = { ...ITEM, id: 'p2' }
    const errored = { ...ITEM, id: 'e1' }
    const missing = { ...ITEM, id: 'm1' }
    const thrower = { ...ITEM, id: 't1' }
    const h = harness(
      {
        p2: { input, inputs: 'run', output: quiet },
        e1: { input, error: 'x' },
        t1: { input, inputs: 'run', output: strong },
      },
      async (_command, _args, options) => {
        if (options?.cwd !== undefined) throw 'check broke'
        return JSON.stringify({ structured_output: { matches: [] } })
      },
    )
    await gradeAll([other, errored, missing], OPTIONS, h.deps)
    expect(h.prepared).toEqual([])
    expect(JSON.parse(h.store.get('o/raw/p2.json') as string).graded.checks).toEqual([null])
    await gradeAll([thrower], OPTIONS, h.deps)
    expect(h.logs).toContain('grade t1 failed: check broke')
    h.deps.exec = async () => {
      throw new Error('judge broke')
    }
    await gradeAll([thrower], OPTIONS, h.deps)
    expect(h.logs).toContain('grade t1 failed: judge broke')
  })
})
