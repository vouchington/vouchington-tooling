import { createHash } from 'node:crypto'
import { join } from 'node:path'

import type { Finding } from '../finding.mts'
import type { EvalCase } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import { pool } from './judge-all.mts'
import { judgeFindings, type Assignment } from './judge.mts'
import { checkFindings, type Check } from './verifier-check.mts'
import type { VerifierInput } from './verifier-input.mts'
import type { VerifierOutput } from './verifier-run.mts'

/**
 * How the verifier's own output was graded: `added` assigns each expectation to one of the
 * findings the verifier raised itself (by position among them), and `checks` holds an
 * independent verdict for each uncredited blocking or high output finding (null when unchecked).
 */
export type Graded = {
  judge: string
  checker: string
  inputs: string
  added: Assignment
  checks: Array<Check | null>
}

export type VerifierRaw = { input: VerifierInput } & (
  | { output: VerifierOutput; graded?: Graded }
  | { error: string }
)

/** Output findings that cite any of `indexes` as a source. */
export function referencing(output: VerifierOutput, indexes: readonly number[]): number[] {
  return output.sources.flatMap((list, at) => (list.some((i) => indexes.includes(i)) ? [at] : []))
}

/** Output findings with no sources: the ones the verifier raised itself. */
export function addedIndexes(output: VerifierOutput): number[] {
  return output.sources.flatMap((list, at) => (list.length === 0 ? [at] : []))
}

/** For each expectation, the output findings that raise it, through a real input or directly. */
export function creditedOutputs(
  item: EvalCase,
  input: VerifierInput,
  output: VerifierOutput,
  added: Assignment,
): number[][] {
  const credited = item.expected.map((): number[] => [])
  for (const [index, expected] of input.real) {
    const copy = input.planted.find(([original]) => original === index)?.[1]
    credited[expected]?.push(...referencing(output, copy === undefined ? [index] : [index, copy]))
  }
  const fresh = addedIndexes(output)
  added.forEach((at, expected) => {
    const target = at === null ? undefined : fresh[at]
    if (target !== undefined) credited[expected]?.push(target)
  })
  return credited
}

export function gradeInputs(item: EvalCase, output: VerifierOutput, models: string[]): string {
  const payload = JSON.stringify({ expected: item.expected, output, models })
  return createHash('sha256').update(payload).digest('hex')
}

export type GradeOptions = {
  findingsFrom: string
  out: string
  judge: string
  checker: string
  maxTurns: number
  jobs: number
}

async function gradeCase(
  item: EvalCase,
  input: VerifierInput,
  output: VerifierOutput,
  options: GradeOptions,
  deps: BenchDeps,
): Promise<Graded> {
  const fresh = addedIndexes(output).map((at) => output.findings[at] as Finding)
  const added = await judgeFindings(item.expected, fresh, options.judge, deps.exec)
  const credited = new Set(creditedOutputs(item, input, output, added).flat())
  const strong = output.findings.flatMap((finding, at) =>
    (finding.severity === 'blocking' || finding.severity === 'high') && !credited.has(at)
      ? [at]
      : [],
  )
  let checks = new Map<number, Check>()
  if (strong.length > 0) {
    const cache = join(options.findingsFrom, 'cache')
    const { dir } = await deps.prepare(item, cache, join(options.out, 'work'), deps.exec)
    const run = { model: options.checker, maxTurns: options.maxTurns }
    checks = await checkFindings(dir, output.findings, strong, run, deps.exec)
  }
  return {
    judge: options.judge,
    checker: options.checker,
    inputs: gradeInputs(item, output, [options.judge, options.checker]),
    added,
    checks: output.findings.map((_, at) => checks.get(at) ?? null),
  }
}

/** Grades every verifier result that lacks a current grade from these models. */
export async function gradeAll(
  cases: readonly EvalCase[],
  options: GradeOptions,
  deps: BenchDeps,
): Promise<void> {
  await pool(cases, options.jobs, async (item) => {
    const path = join(options.out, 'raw', `${item.id}.json`)
    if (!deps.exists(path)) return
    const raw = JSON.parse(deps.readFile(path)) as VerifierRaw
    if ('error' in raw) return
    const current = gradeInputs(item, raw.output, [options.judge, options.checker])
    if (raw.graded?.inputs === current) return
    deps.log(`grade ${item.id}`)
    try {
      const graded = await gradeCase(item, raw.input, raw.output, options, deps)
      deps.writeFile(path, `${JSON.stringify({ ...raw, graded }, null, 2)}\n`)
    } catch (error) {
      deps.log(`grade ${item.id} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
