import { describe, expect, it, vi } from 'vitest'

import type { EvalCase } from './cases.mts'
import { judgeAll, pool, type JudgeDeps } from './judge-all.mts'

function item(id: string, kind: EvalCase['kind']): EvalCase {
  return {
    id,
    repo: 'acme/widgets',
    pr: 1,
    title: id,
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    kind,
    reason: '',
    expected:
      kind === 'positive'
        ? [{ pillar: 'design', severity: 'high', path: null, lines: null, claim: 'c' }]
        : [],
  }
}

const finding = { pillar: 'design', severity: 'high', title: 'T', body: 'B' }
const path = (id: string) => `out/raw/design/${id}.json`

function deps(files: Record<string, unknown>, exec: JudgeDeps['exec']) {
  const store = new Map(Object.entries(files).map(([key, value]) => [key, JSON.stringify(value)]))
  const logs: string[] = []
  const value: JudgeDeps = {
    exec,
    readFile: (file) => store.get(file) as string,
    writeFile: (file, text) => void store.set(file, text),
    exists: (file) => store.has(file),
    log: (line) => void logs.push(line),
  }
  return { value, store, logs }
}

describe('pool', () => {
  it('runs every item with at least one worker', async () => {
    const seen: number[] = []
    await pool([1, 2, 3], 0, async (n) => void seen.push(n))
    expect(seen).toEqual([1, 2, 3])
  })
})

describe('judgeAll', () => {
  it('judges raw results and skips missing, errored, and already judged ones', async () => {
    const exec = vi.fn(async () =>
      JSON.stringify({ structured_output: { matches: [{ expected: 0, finding: 0 }] } }),
    )
    const cases = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => item(id, 'positive'))
    const { value, store, logs } = deps(
      {
        [path('p1')]: { findings: [finding] },
        [path('p2')]: { error: 'boom' },
        [path('p3')]: { findings: [finding], judged: { model: 'm', assignment: [null] } },
        [path('p4')]: { findings: [finding], judged: { model: 'old', assignment: [null] } },
      },
      exec,
    )
    await judgeAll(cases, ['design'], { out: 'out', model: 'm', jobs: 2 }, value)
    expect(JSON.parse(store.get(path('p1')) as string).judged).toEqual({
      model: 'm',
      assignment: [0],
    })
    expect(JSON.parse(store.get(path('p3')) as string).judged.assignment).toEqual([null])
    expect(JSON.parse(store.get(path('p4')) as string).judged).toEqual({
      model: 'm',
      assignment: [0],
    })
    expect(exec).toHaveBeenCalledTimes(2)
    expect(logs.sort()).toEqual(['judge design p1', 'judge design p4'])
  })

  it('logs judge failures and leaves the raw result unjudged', async () => {
    const run = async (error: unknown) => {
      const { value, store, logs } = deps({ [path('p1')]: { findings: [finding] } }, async () => {
        throw error
      })
      await judgeAll(
        [item('p1', 'positive')],
        ['design'],
        { out: 'out', model: 'm', jobs: 1 },
        value,
      )
      expect(JSON.parse(store.get(path('p1')) as string)).not.toHaveProperty('judged')
      return logs
    }
    expect(await run(new Error('bad'))).toContain('judge design p1 failed: bad')
    expect(await run('str')).toContain('judge design p1 failed: str')
  })
})
