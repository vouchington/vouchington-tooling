import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BenchDeps } from './cli.mts'
import { judgeInputs } from './judge-all.mts'
import { runFinalReviewVerifierBenchCli } from './verifier-cli.mts'
import { gradeInputs } from './verifier-grade.mts'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

const caseJson = (id: string, kind: 'positive' | 'negative') => ({
  id,
  repo: 'acme/widgets',
  pr: 1,
  title: id,
  baseSha: SHA_A,
  headSha: SHA_B,
  kind,
  reason: '',
  expected:
    kind === 'positive'
      ? [{ pillar: 'design', severity: 'high', path: 'a.ts', lines: [1, 2], claim: 'c' }]
      : [],
})

const CASES = [caseJson('p1', 'positive'), caseJson('n1', 'negative'), caseJson('x1', 'negative')]
const FINDING = { pillar: 'design', severity: 'high', title: 'T', body: 'B' }

function harness(exec: BenchDeps['exec']) {
  const store = new Map<string, string>([
    ['cases.json', JSON.stringify(CASES)],
    ['refs/verifier.md', 'VERIFIER'],
    ['refs/pillars/congruence.md', 'CONGRUENCE'],
    [
      'f/raw/design/p1.json',
      JSON.stringify({
        findings: [FINDING],
        judged: {
          model: 'sonnet',
          inputs: judgeInputs(CASES[0]?.expected as never, [FINDING] as never),
          assignment: [0],
        },
      }),
    ],
    ['f/raw/design/n1.json', JSON.stringify({ findings: [FINDING] })],
  ])
  const logs: string[] = []
  const deps: BenchDeps = {
    exec,
    readFile: (path) => {
      const text = store.get(path)
      if (text === undefined) throw new Error(`ENOENT ${path}`)
      return text
    },
    writeFile: (path, text) => void store.set(path, text),
    exists: (path) => store.has(path),
    log: (line) => void logs.push(line),
    prepare: async (item) => ({ dir: `/snap/${item.id}`, diff: '', body: '' }),
  }
  return { deps, store, logs }
}

const BASE = ['--cases', 'cases.json', '--findings-from', 'f', '--out', 'o']

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runFinalReviewVerifierBenchCli', () => {
  it('validates arguments', async () => {
    const { deps } = harness(async () => '')
    await expect(runFinalReviewVerifierBenchCli(['--out', 'o'], deps)).rejects.toThrow(
      'bench-verifier needs --cases, --findings-from, and --out.',
    )
    await expect(runFinalReviewVerifierBenchCli(BASE, deps)).rejects.toThrow(
      'bench-verifier needs --prompts.',
    )
  })

  it('verifies saved findings per case, records failures, and scores', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const prompts: string[] = []
    const h = harness(async (_command, args, options) => {
      prompts.push(args[1] as string)
      if (options?.cwd === '/snap/n1') throw 'verifier crashed'
      return JSON.stringify({
        structured_output: { summary: 's', findings: [{ ...FINDING, sources: [0, 1] }] },
      })
    })
    const args = [...BASE, '--prompts', 'refs', '--jobs', '1', '--model', 'opus']
    await expect(runFinalReviewVerifierBenchCli(args, h.deps)).resolves.toBe(0)
    expect(prompts[0]?.startsWith('VERIFIER\n\nCONGRUENCE\n\n## Benchmark run')).toBe(true)
    expect(h.logs).toContain('skip x1: no pillar findings')
    expect(h.logs).toContain('verify p1')
    expect(h.logs).toContain('judge design n1')
    const markdown = h.store.get('o/summary.md') as string
    expect(markdown).toContain(
      'Labels judged by sonnet; other blocking and high findings checked by opus.',
    )
    expect(markdown).toContain('| 1 | 100% | 100% → 100% | 100% | n/a (0) | 100% | 1.0 → 1.0 |')
    expect(markdown).toContain('- n1: verifier crashed')
    expect(out).toHaveBeenCalledWith(`${markdown.trimEnd()}\n`)
  })

  it('scores saved runs only with --score-only', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exec = vi.fn(async () => '')
    const h = harness(exec)
    const input = { findings: [FINDING], real: [], planted: [] }
    const output = { summary: '', findings: [], sources: [] }
    const n1 = CASES[1] as never
    const graded = {
      judge: 'haiku',
      checker: 'opus',
      inputs: gradeInputs(n1, output, ['haiku', 'opus']),
      added: [],
      checks: [],
    }
    h.store.set('o/raw/n1.json', JSON.stringify({ input, output, graded }))
    h.store.set('o/raw/x1.json', JSON.stringify({ input, output }))
    await runFinalReviewVerifierBenchCli([...BASE, '--score-only', '--judge', 'haiku'], h.deps)
    expect(exec).not.toHaveBeenCalled()
    const markdown = h.store.get('o/summary.md') as string
    expect(markdown).toContain('judged by haiku')
    expect(markdown).toContain('| 1 | n/a | n/a → n/a | n/a | n/a (0) | n/a | 1.0 → 0.0 |')
    expect(markdown).toContain('- x1: not graded')
  })

  it('reuses saved verifier outputs', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exec = vi.fn(async () => '')
    const h = harness(exec)
    const output = { summary: '', findings: [], sources: [] }
    h.store.set(
      'o/raw/p1.json',
      JSON.stringify({ input: { findings: [], real: [], planted: [] }, output }),
    )
    await runFinalReviewVerifierBenchCli([...BASE, '--prompts', 'refs', '--case', 'p1'], h.deps)
    expect(exec).not.toHaveBeenCalled()
    expect(JSON.parse(h.store.get('o/raw/p1.json') as string).graded.added).toEqual([null])
  })

  it('records non-crashing errors from Error instances', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = harness(async () => {
      throw new Error('bad')
    })
    h.deps.exists = (path) => path !== 'f/raw/design/n1.json' && h.store.has(path)
    await runFinalReviewVerifierBenchCli([...BASE, '--prompts', 'refs', '--case', 'p1'], h.deps)
    expect(h.store.get('o/summary.md')).toContain('- p1: bad')
  })
})
