import { createHash } from 'node:crypto'
import { join } from 'node:path'

import type { Finding, Pillar } from '../finding.mts'
import { casesForPillar, type EvalCase, type ExpectedFinding } from './cases.mts'
import { judgeFindings, type Assignment, type Judged } from './judge.mts'
import type { Exec } from './snapshot.mts'

export type RawResult = { findings: Finding[]; judged?: Judged } | { error: string }

export type JudgeDeps = {
  exec: Exec
  readFile(path: string): string
  writeFile(path: string, text: string): void
  exists(path: string): boolean
  log(line: string): void
}

/** Fingerprints what a judgement indexes, so edited claims or re-run findings invalidate it. */
export function judgeInputs(
  expected: readonly ExpectedFinding[],
  findings: readonly Finding[],
): string {
  return createHash('sha256').update(JSON.stringify({ expected, findings })).digest('hex')
}

/** The cached assignment when it was made by `model` for exactly these inputs, else undefined. */
export function currentAssignment(
  raw: { findings: Finding[]; judged?: Judged },
  expected: readonly ExpectedFinding[],
  model: string,
): Assignment | undefined {
  const judged = raw.judged
  if (judged?.model !== model || judged.inputs !== judgeInputs(expected, raw.findings))
    return undefined
  return judged.assignment
}

/** Runs `work` over `items` with at most `jobs` in flight. */
export async function pool<T>(
  items: readonly T[],
  jobs: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item)
  }
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker))
}

/** Adds a judge assignment to every raw result that lacks a current one from this model. */
export async function judgeAll(
  cases: readonly EvalCase[],
  pillars: readonly Pillar[],
  options: { out: string; model: string; jobs: number },
  deps: JudgeDeps,
): Promise<void> {
  const tasks = pillars.flatMap((pillar) =>
    casesForPillar(cases, pillar).map((item) => ({ pillar, item })),
  )
  await pool(tasks, options.jobs, async ({ pillar, item }) => {
    const path = join(options.out, 'raw', pillar, `${item.id}.json`)
    if (!deps.exists(path)) return
    const raw = JSON.parse(deps.readFile(path)) as RawResult
    const expected = item.expected.filter((entry) => entry.pillar === pillar)
    if ('error' in raw || currentAssignment(raw, expected, options.model) !== undefined) return
    deps.log(`judge ${pillar} ${item.id}`)
    try {
      const assignment = await judgeFindings(expected, raw.findings, options.model, deps.exec)
      const judged: Judged = {
        model: options.model,
        inputs: judgeInputs(expected, raw.findings),
        assignment,
      }
      deps.writeFile(path, `${JSON.stringify({ ...raw, judged }, null, 2)}\n`)
    } catch (error) {
      deps.log(
        `judge ${pillar} ${item.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })
}
