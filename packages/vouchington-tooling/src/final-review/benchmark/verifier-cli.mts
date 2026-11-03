import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { PILLARS } from '../finding.mts'
import { parseEvalCases, type EvalCase } from './cases.mts'
import { defaultBenchDeps, type BenchDeps } from './cli.mts'
import { judgeAll, pool } from './judge-all.mts'
import { gradeAll, gradeInputs, type VerifierRaw } from './verifier-grade.mts'
import { collectVerifierInput } from './verifier-input.mts'
import { runVerifier, verifierRunInputs, type VerifierRun } from './verifier-run.mts'
import {
  renderVerifierTable,
  scoreVerifierCase,
  summarizeVerifier,
  type VerifierCaseScore,
} from './verifier-score.mts'

type Options = {
  findingsFrom: string
  out: string
  prompts: string
  model: string
  maxTurns: number
  jobs: number
  judge: string
  checker: string
}

function readRaw(path: string, deps: BenchDeps): VerifierRaw | undefined {
  return deps.exists(path) ? (JSON.parse(deps.readFile(path)) as VerifierRaw) : undefined
}

/** verifier.md with the files it links inlined, since the snapshot has no skill files. */
function verifierPrompt(prompts: string, deps: BenchDeps): string {
  return [
    deps.readFile(join(prompts, 'verifier.md')).trim(),
    deps.readFile(join(prompts, 'pillars', '_contract.md')).trim(),
    deps.readFile(join(prompts, 'pillars', 'congruence.md')).trim(),
  ].join('\n\n')
}

async function runAll(cases: EvalCase[], options: Options, deps: BenchDeps): Promise<void> {
  const run: VerifierRun = {
    verifierPrompt: verifierPrompt(options.prompts, deps),
    model: options.model,
    maxTurns: options.maxTurns,
  }
  const tasks = cases.flatMap((item) => {
    const input = collectVerifierInput(item, options.findingsFrom, options.judge, deps)
    if (input === null) {
      deps.log(`skip ${item.id}: no pillar findings`)
      return []
    }
    // A saved output is reused only for the same run, so a resume never reports stale results.
    const inputs = verifierRunInputs(item, input, run)
    const saved = readRaw(join(options.out, 'raw', `${item.id}.json`), deps)
    if (saved !== undefined && 'output' in saved && saved.inputs === inputs) return []
    return [{ item, input, inputs }]
  })
  await pool(tasks, options.jobs, async ({ item, input, inputs }) => {
    deps.log(`verify ${item.id}`)
    let raw: VerifierRaw
    try {
      const cache = join(options.findingsFrom, 'cache')
      const { dir } = await deps.prepare(item, cache, join(options.out, 'work'), deps.exec)
      raw = { input, inputs, output: await runVerifier(item, dir, input.findings, run, deps.exec) }
    } catch (error) {
      raw = { input, error: error instanceof Error ? error.message : String(error) }
    }
    deps.writeFile(join(options.out, 'raw', `${item.id}.json`), `${JSON.stringify(raw, null, 2)}\n`)
  })
}

function scoreAll(cases: EvalCase[], options: Options, deps: BenchDeps): string {
  const scores: VerifierCaseScore[] = []
  const errors: string[] = []
  for (const item of cases) {
    const raw = readRaw(join(options.out, 'raw', `${item.id}.json`), deps)
    if (raw === undefined) continue
    if ('error' in raw) errors.push(`- ${item.id}: ${raw.error}`)
    else if (raw.graded?.inputs !== gradeInputs(item, raw.output, [options.judge, options.checker]))
      errors.push(`- ${item.id}: not graded`)
    else scores.push(scoreVerifierCase(item, raw.input, raw.output, raw.graded))
  }
  const summary = summarizeVerifier(scores)
  deps.writeFile(
    join(options.out, 'summary.json'),
    `${JSON.stringify({ summary, scores, errors }, null, 2)}\n`,
  )
  const markdown = [
    `Labels judged by ${options.judge}; other blocking and high findings checked by ${options.checker}.`,
    renderVerifierTable(summary),
    ...(errors.length > 0 ? ['Errors:', errors.join('\n')] : []),
  ].join('\n\n')
  deps.writeFile(join(options.out, 'summary.md'), `${markdown}\n`)
  return markdown
}

/**
 * `vouchington final-review bench-verifier`: run the verifier alone on saved pillar findings, one
 * model call per case and no subagents, and score what it keeps, merges, and drops.
 */
export async function runFinalReviewVerifierBenchCli(
  args: string[],
  deps: BenchDeps = defaultBenchDeps,
): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      cases: { type: 'string' },
      'findings-from': { type: 'string' },
      prompts: { type: 'string' },
      out: { type: 'string' },
      case: { type: 'string', multiple: true },
      model: { type: 'string' },
      'max-turns': { type: 'string' },
      jobs: { type: 'string' },
      'score-only': { type: 'boolean' },
      judge: { type: 'string' },
      checker: { type: 'string' },
    },
  })
  const { cases: casesPath, out } = values
  const findingsFrom = values['findings-from']
  if (casesPath === undefined || out === undefined || findingsFrom === undefined)
    throw new Error('bench-verifier needs --cases, --findings-from, and --out.')
  const scoreOnly = values['score-only'] === true
  if (!scoreOnly && values.prompts === undefined) throw new Error('bench-verifier needs --prompts.')
  const ids = new Set(values.case ?? [])
  const cases = parseEvalCases(JSON.parse(deps.readFile(casesPath)) as unknown).filter(
    (item) => ids.size === 0 || ids.has(item.id),
  )
  const options: Options = {
    findingsFrom,
    out,
    prompts: values.prompts ?? '',
    model: values.model ?? 'opus',
    maxTurns: Number(values['max-turns'] ?? '60'),
    jobs: Number(values.jobs ?? '3'),
    judge: values.judge ?? 'sonnet',
    checker: values.checker ?? 'opus',
  }
  if (!scoreOnly) {
    await judgeAll(
      cases,
      PILLARS,
      { out: findingsFrom, model: options.judge, jobs: options.jobs },
      deps,
    )
    await runAll(cases, options, deps)
    await gradeAll(cases, options, deps)
  }
  process.stdout.write(`${scoreAll(cases, options, deps)}\n`)
  return 0
}
