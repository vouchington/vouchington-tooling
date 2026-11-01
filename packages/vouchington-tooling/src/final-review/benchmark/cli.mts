import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

import { PILLARS, type Pillar } from '../finding.mts'
import { casesForPillar, parseEvalCases, type EvalCase } from './cases.mts'
import { currentAssignment, judgeAll, pool, type RawResult } from './judge-all.mts'
import { runPillar } from './runner.mts'
import { renderSummaryTable, scoreCase, summarizePillar, type CaseScore } from './score.mts'
import { defaultExec, prepareSnapshot, type Exec } from './snapshot.mts'

export type BenchDeps = {
  exec: Exec
  readFile(path: string): string
  writeFile(path: string, text: string): void
  exists(path: string): boolean
  log(line: string): void
  prepare: typeof prepareSnapshot
}

const defaultDeps: BenchDeps = {
  exec: defaultExec,
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, text) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  },
  exists: existsSync,
  log: (line) => process.stderr.write(`${line}\n`),
  prepare: prepareSnapshot,
}

function pickPillars(requested: string[], cases: readonly EvalCase[]): Pillar[] {
  if (requested.length > 0) {
    return requested.map((name) => {
      const pillar = PILLARS.find((candidate) => candidate === name)
      if (pillar === undefined) throw new Error(`Unknown pillar: ${name}`)
      return pillar
    })
  }
  const used = new Set(cases.flatMap((item) => item.expected.map((entry) => entry.pillar)))
  return PILLARS.filter((pillar) => used.has(pillar))
}

type Options = {
  out: string
  prompts: string
  model: string
  maxTurns: number
  jobs: number
  scoreOnly: boolean
  judge: string | undefined
}

async function runAll(
  cases: EvalCase[],
  pillars: Pillar[],
  options: Options,
  deps: BenchDeps,
): Promise<void> {
  const rawPath = (pillar: Pillar, id: string) => join(options.out, 'raw', pillar, `${id}.json`)
  if (options.scoreOnly) return
  const snapshots = new Map<string, string>()
  for (const item of new Set(pillars.flatMap((pillar) => casesForPillar(cases, pillar)))) {
    deps.log(`snapshot ${item.id}`)
    snapshots.set(
      item.id,
      (await deps.prepare(item, join(options.out, 'cache'), join(options.out, 'work'), deps.exec))
        .dir,
    )
  }
  const contractPath = join(options.prompts, '_contract.md')
  const contract = deps.exists(contractPath) ? deps.readFile(contractPath).trim() : ''
  const tasks = pillars.flatMap((pillar) => {
    const pillarPrompt = [contract, deps.readFile(join(options.prompts, `${pillar}.md`))]
      .filter((part) => part.length > 0)
      .join('\n\n')
    return casesForPillar(cases, pillar).map((item) => ({ pillar, pillarPrompt, item }))
  })
  await pool(tasks, options.jobs, async ({ pillar, pillarPrompt, item }) => {
    deps.log(`run ${pillar} ${item.id}`)
    const dir = snapshots.get(item.id) as string
    let result: RawResult
    try {
      const run = { pillar, pillarPrompt, model: options.model, maxTurns: options.maxTurns }
      result = { findings: await runPillar(item, dir, run, deps.exec) }
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) }
    }
    deps.writeFile(rawPath(pillar, item.id), `${JSON.stringify(result, null, 2)}\n`)
  })
}

function scoreAll(cases: EvalCase[], pillars: Pillar[], options: Options, deps: BenchDeps): string {
  const { out, judge } = options
  const report = pillars.map((pillar) => {
    const scores: CaseScore[] = []
    const errors: string[] = []
    for (const item of casesForPillar(cases, pillar)) {
      const path = join(out, 'raw', pillar, `${item.id}.json`)
      if (!deps.exists(path)) {
        errors.push(`${item.id}: not run`)
        continue
      }
      const raw = JSON.parse(deps.readFile(path)) as RawResult
      if ('error' in raw) errors.push(`${item.id}: ${raw.error}`)
      else if (judge === undefined) scores.push(scoreCase(item, pillar, raw.findings))
      else {
        const expected = item.expected.filter((entry) => entry.pillar === pillar)
        const assignment = currentAssignment(raw, expected, judge)
        // Unjudged cases stay out of judged metrics rather than falling back to locations.
        if (assignment === undefined) errors.push(`${item.id}: not judged`)
        else scores.push(scoreCase(item, pillar, raw.findings, assignment))
      }
    }
    return { summary: summarizePillar(pillar, scores), scores, errors }
  })
  deps.writeFile(join(out, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`)
  const errorLines = report.flatMap((entry) =>
    entry.errors.map((line) => `- ${entry.summary.pillar} ${line}`),
  )
  const matching = judge === undefined ? 'file and line' : `claims judged by ${judge}`
  const markdown = [
    `Matching: ${matching}.`,
    renderSummaryTable(report.map((entry) => entry.summary)),
    ...(errorLines.length > 0 ? ['Errors and skipped runs:', errorLines.join('\n')] : []),
  ].join('\n\n')
  deps.writeFile(join(out, 'summary.md'), `${markdown}\n`)
  return markdown
}

/** `vouchington final-review bench`: run pillar prompts over labeled cases and score them. */
export async function runFinalReviewBenchCli(
  args: string[],
  deps: BenchDeps = defaultDeps,
): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      cases: { type: 'string' },
      prompts: { type: 'string' },
      out: { type: 'string' },
      pillar: { type: 'string', multiple: true },
      case: { type: 'string', multiple: true },
      model: { type: 'string' },
      'max-turns': { type: 'string' },
      jobs: { type: 'string' },
      'score-only': { type: 'boolean' },
      judge: { type: 'string' },
    },
  })
  if (values.cases === undefined || values.out === undefined)
    throw new Error('bench needs --cases and --out.')
  if (values['score-only'] !== true && values.prompts === undefined)
    throw new Error('bench needs --prompts.')
  const ids = new Set(values.case ?? [])
  const cases = parseEvalCases(JSON.parse(deps.readFile(values.cases)) as unknown).filter(
    (item) => ids.size === 0 || ids.has(item.id),
  )
  const pillars = pickPillars(values.pillar ?? [], cases)
  const options: Options = {
    out: values.out,
    prompts: values.prompts ?? '',
    model: values.model ?? 'sonnet',
    maxTurns: Number(values['max-turns'] ?? '40'),
    jobs: Number(values.jobs ?? '3'),
    scoreOnly: values['score-only'] === true,
    judge: values.judge,
  }
  await runAll(cases, pillars, options, deps)
  if (options.judge !== undefined) {
    await judgeAll(
      cases,
      pillars,
      { out: options.out, model: options.judge, jobs: options.jobs },
      deps,
    )
  }
  process.stdout.write(`${scoreAll(cases, pillars, options, deps)}\n`)
  return 0
}
