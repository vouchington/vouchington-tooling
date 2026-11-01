import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { PILLARS } from '../finding.mts'
import { parseEvalCases, type EvalCase } from './cases.mts'
import { defaultBenchDeps, type BenchDeps } from './cli.mts'
import { judgeAll, pool } from './judge-all.mts'
import { collectVerifierInput, type VerifierInput } from './verifier-input.mts'
import { runVerifier, type VerifierOutput } from './verifier-run.mts'
import {
  renderVerifierTable,
  scoreVerifierCase,
  summarizeVerifier,
  type VerifierCaseScore,
} from './verifier-score.mts'

type VerifierRaw = { input: VerifierInput } & ({ output: VerifierOutput } | { error: string })

type Options = {
  findingsFrom: string
  out: string
  prompts: string
  model: string
  maxTurns: number
  jobs: number
  judge: string
}

/** verifier.md with the congruence pillar inlined, since the snapshot has no skill files. */
function verifierPrompt(prompts: string, deps: BenchDeps): string {
  return [
    deps.readFile(join(prompts, 'verifier.md')).trim(),
    deps.readFile(join(prompts, 'pillars', 'congruence.md')).trim(),
  ].join('\n\n')
}

async function runAll(cases: EvalCase[], options: Options, deps: BenchDeps): Promise<void> {
  const prompt = verifierPrompt(options.prompts, deps)
  const tasks = cases.flatMap((item) => {
    const input = collectVerifierInput(item, options.findingsFrom, options.judge, deps)
    if (input === null) deps.log(`skip ${item.id}: no pillar findings`)
    return input === null ? [] : [{ item, input }]
  })
  await pool(tasks, options.jobs, async ({ item, input }) => {
    deps.log(`verify ${item.id}`)
    let raw: VerifierRaw
    try {
      const cache = join(options.findingsFrom, 'cache')
      const { dir } = await deps.prepare(item, cache, join(options.out, 'work'), deps.exec)
      const run = { verifierPrompt: prompt, model: options.model, maxTurns: options.maxTurns }
      raw = { input, output: await runVerifier(item, dir, input.findings, run, deps.exec) }
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
    const path = join(options.out, 'raw', `${item.id}.json`)
    if (!deps.exists(path)) continue
    const raw = JSON.parse(deps.readFile(path)) as VerifierRaw
    if ('error' in raw) errors.push(`- ${item.id}: ${raw.error}`)
    else scores.push(scoreVerifierCase(item, raw.input, raw.output))
  }
  const summary = summarizeVerifier(scores)
  deps.writeFile(
    join(options.out, 'summary.json'),
    `${JSON.stringify({ summary, scores, errors }, null, 2)}\n`,
  )
  const markdown = [
    `Real findings: pillar findings judged by ${options.judge}.`,
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
  }
  if (!scoreOnly) {
    await judgeAll(
      cases,
      PILLARS,
      { out: findingsFrom, model: options.judge, jobs: options.jobs },
      deps,
    )
    await runAll(cases, options, deps)
  }
  process.stdout.write(`${scoreAll(cases, options, deps)}\n`)
  return 0
}
