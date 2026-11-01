import { afterEach, describe, expect, it, vi } from 'vitest'

import { runFinalReviewBenchCli, type BenchDeps } from './cli.mts'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

function caseJson(id: string, kind: 'positive' | 'negative', pillar = 'security') {
  return {
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
        ? [{ pillar, severity: 'high', path: 'src/a.ts', lines: [5, 6], claim: 'c' }]
        : [],
  }
}

const CASES = [caseJson('p1', 'positive'), caseJson('n1', 'negative')]

const claudeOutput = (findings: unknown[]) => JSON.stringify({ structured_output: { findings } })

const HIT = claudeOutput([{ severity: 'high', title: 'T', body: 'B', path: 'src/a.ts', line: 5 }])

type Harness = {
  deps: BenchDeps
  files: Map<string, string>
  logs: string[]
  execCalls: Array<{ command: string; args: string[]; cwd?: string | undefined }>
  prepared: string[]
}

function harness(
  files: Record<string, string>,
  exec: (cwd: string | undefined) => Promise<string> = async () => HIT,
): Harness {
  const store = new Map(Object.entries(files))
  const logs: string[] = []
  const execCalls: Harness['execCalls'] = []
  const prepared: string[] = []
  const deps: BenchDeps = {
    exec: async (command, args, options) => {
      execCalls.push({ command, args, cwd: options?.cwd })
      return exec(options?.cwd)
    },
    readFile: (path) => {
      const text = store.get(path)
      if (text === undefined) throw new Error(`ENOENT ${path}`)
      return text
    },
    writeFile: (path, text) => void store.set(path, text),
    exists: (path) => store.has(path),
    log: (line) => void logs.push(line),
    prepare: async (item) => {
      prepared.push(item.id)
      return { dir: `/snap/${item.id}`, diff: '', body: '' }
    },
  }
  return { deps, files: store, logs, execCalls, prepared }
}

function stdoutSpy() {
  return vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
}

afterEach(() => {
  vi.restoreAllMocks()
})

const BASE = ['--cases', 'cases.json', '--out', 'out', '--prompts', 'prompts']

describe('runFinalReviewBenchCli arguments', () => {
  it('requires --cases, --out, and --prompts unless scoring only', async () => {
    const { deps } = harness({})
    await expect(runFinalReviewBenchCli(['--out', 'o'], deps)).rejects.toThrow(
      'bench needs --cases and --out.',
    )
    await expect(runFinalReviewBenchCli(['--cases', 'c'], deps)).rejects.toThrow(
      'bench needs --cases and --out.',
    )
    await expect(runFinalReviewBenchCli(['--cases', 'c', '--out', 'o'], deps)).rejects.toThrow(
      'bench needs --prompts.',
    )
  })

  it('rejects unknown flags and unknown pillars', async () => {
    const { deps } = harness({ 'cases.json': JSON.stringify(CASES) })
    await expect(runFinalReviewBenchCli([...BASE, '--bogus'], deps)).rejects.toThrow()
    await expect(runFinalReviewBenchCli([...BASE, '--pillar', 'nope'], deps)).rejects.toThrow(
      'Unknown pillar: nope',
    )
  })
})

describe('runFinalReviewBenchCli runs', () => {
  it('snapshots, runs each pillar, and writes raw results and summaries', async () => {
    const out = stdoutSpy()
    const h = harness({
      'cases.json': JSON.stringify(CASES),
      'prompts/security.md': 'Security prompt',
    })
    await expect(runFinalReviewBenchCli(BASE, h.deps)).resolves.toBe(0)
    expect(h.prepared.sort((a, b) => a.localeCompare(b))).toEqual(['n1', 'p1'])
    expect(h.logs).toContain('snapshot p1')
    expect(h.logs).toContain('run security n1')
    expect(h.execCalls.map((call) => call.cwd ?? '').sort((a, b) => a.localeCompare(b))).toEqual([
      '/snap/n1',
      '/snap/p1',
    ])
    expect(JSON.parse(h.files.get('out/raw/security/p1.json') as string).findings).toHaveLength(1)
    const summary = JSON.parse(h.files.get('out/summary.json') as string)
    expect(summary[0].summary).toMatchObject({ pillar: 'security', recall: 1, falseAlarmRate: 1 })
    const markdown = h.files.get('out/summary.md') as string
    expect(markdown).toContain('| security | 2 | 100% |')
    expect(markdown).not.toContain('Errors and skipped runs')
    expect(out).toHaveBeenCalledWith(`${markdown.trimEnd()}\n`)
  })

  it('prefixes each pillar prompt with the shared contract when present', async () => {
    stdoutSpy()
    const h = harness({
      'cases.json': JSON.stringify(CASES),
      'prompts/_contract.md': 'Shared contract\n',
      'prompts/security.md': 'Security prompt',
    })
    await runFinalReviewBenchCli(BASE, h.deps)
    const prompt = h.execCalls[0]?.args[1] ?? ''
    expect(prompt.startsWith('Shared contract\n\nSecurity prompt')).toBe(true)
  })

  it('records run failures as errors and keeps going', async () => {
    stdoutSpy()
    const h = harness(
      { 'cases.json': JSON.stringify(CASES), 'prompts/security.md': 'P' },
      async (cwd) => {
        if (cwd === '/snap/p1') throw new Error('claude exploded')
        // eslint-disable-next-line no-throw-literal
        throw 'plain string'
      },
    )
    await runFinalReviewBenchCli([...BASE, '--jobs', '0'], h.deps)
    expect(JSON.parse(h.files.get('out/raw/security/p1.json') as string)).toEqual({
      error: 'claude exploded',
    })
    expect(JSON.parse(h.files.get('out/raw/security/n1.json') as string)).toEqual({
      error: 'plain string',
    })
    const markdown = h.files.get('out/summary.md') as string
    expect(markdown).toContain('Errors and skipped runs:')
    expect(markdown).toContain('- security p1: claude exploded')
    expect(markdown).toContain('- security n1: plain string')
  })

  it('honors --case, --pillar, --model, and --max-turns', async () => {
    stdoutSpy()
    const h = harness({
      'cases.json': JSON.stringify(CASES),
      'prompts/design.md': 'D',
      'prompts/security.md': 'S',
    })
    await runFinalReviewBenchCli(
      [...BASE, '--case', 'n1', '--pillar', 'design', '--model', 'opus', '--max-turns', '7'],
      h.deps,
    )
    expect(h.prepared).toEqual(['n1'])
    expect(h.files.has('out/raw/design/n1.json')).toBe(true)
    expect(h.files.has('out/raw/security/n1.json')).toBe(false)
  })

  it('passes configured model and turns to claude', async () => {
    stdoutSpy()
    const seen: string[][] = []
    const h = harness({ 'cases.json': JSON.stringify(CASES), 'prompts/security.md': 'S' })
    const exec = h.deps.exec
    h.deps.exec = async (command, args, options) => {
      seen.push(args)
      return exec(command, args, options)
    }
    await runFinalReviewBenchCli([...BASE, '--model', 'opus', '--max-turns', '7'], h.deps)
    expect(seen[0]?.[seen[0].indexOf('--model') + 1]).toBe('opus')
    expect(seen[0]?.[seen[0].indexOf('--max-turns') + 1]).toBe('7')
  })
})

describe('runFinalReviewBenchCli --score-only', () => {
  const scoreOnly = ['--cases', 'cases.json', '--out', 'out', '--score-only']

  it('scores existing results and reports missing and failed runs', async () => {
    stdoutSpy()
    const h = harness({
      'cases.json': JSON.stringify([...CASES, caseJson('p2', 'positive')]),
      'out/raw/security/p1.json': JSON.stringify({
        findings: [
          {
            pillar: 'security',
            severity: 'high',
            title: 'T',
            body: 'B',
            path: 'src/a.ts',
            line: 5,
          },
        ],
      }),
      'out/raw/security/p2.json': JSON.stringify({ error: 'boom' }),
    })
    await expect(runFinalReviewBenchCli(scoreOnly, h.deps)).resolves.toBe(0)
    expect(h.prepared).toEqual([])
    expect(h.execCalls).toEqual([])
    const markdown = h.files.get('out/summary.md') as string
    expect(markdown).toContain('- security n1: not run')
    expect(markdown).toContain('- security p2: boom')
    expect(markdown).toContain('| security | 1 | 100% |')
  })

  it('judges results with --judge and labels the matching mode', async () => {
    stdoutSpy()
    const judgeOut = JSON.stringify({
      structured_output: { matches: [{ expected: 0, finding: 0 }] },
    })
    const miss = { pillar: 'security', severity: 'low', title: 'T', body: 'B', path: 'x.ts' }
    const h = harness(
      {
        'cases.json': JSON.stringify([...CASES, caseJson('p2', 'positive')]),
        'out/raw/security/p1.json': JSON.stringify({ findings: [miss] }),
        'out/raw/security/p2.json': JSON.stringify({ findings: [miss] }),
      },
      async () => {
        if (h.execCalls.length > 1) throw new Error('judge down')
        return judgeOut
      },
    )
    await expect(runFinalReviewBenchCli([...scoreOnly, '--judge', 'haiku'], h.deps)).resolves.toBe(
      0,
    )
    expect(h.execCalls).toHaveLength(2)
    expect(h.execCalls[0]?.args).toContain('haiku')
    const markdown = h.files.get('out/summary.md') as string
    expect(markdown).toContain('Matching: claims judged by haiku.')
    expect(markdown).toMatch(/- security p[12]: not judged/u)
    // The unjudged case is excluded, not scored by location.
    expect(markdown).toContain('| security | 1 | 100% |')
  })

  it('labels location matching without --judge', async () => {
    stdoutSpy()
    const h = harness({ 'cases.json': JSON.stringify(CASES) })
    await runFinalReviewBenchCli(scoreOnly, h.deps)
    expect(h.files.get('out/summary.md')).toContain('Matching: file and line.')
  })
})
