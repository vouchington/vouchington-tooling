import { join } from 'node:path'

import type { Finding, Pillar } from '../finding.mts'
import { casesForPillar, type EvalCase } from './cases.mts'
import { judgeFindings, type Judged } from './judge.mts'
import type { Exec } from './snapshot.mts'

export type RawResult = { findings: Finding[]; judged?: Judged } | { error: string }

export type JudgeDeps = {
  exec: Exec
  readFile(path: string): string
  writeFile(path: string, text: string): void
  exists(path: string): boolean
  log(line: string): void
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

/** Adds a judge assignment to every raw result that lacks one from this model. */
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
    if ('error' in raw || raw.judged?.model === options.model) return
    deps.log(`judge ${pillar} ${item.id}`)
    const expected = item.expected.filter((entry) => entry.pillar === pillar)
    try {
      const assignment = await judgeFindings(expected, raw.findings, options.model, deps.exec)
      const judged: Judged = { model: options.model, assignment }
      deps.writeFile(path, `${JSON.stringify({ ...raw, judged }, null, 2)}\n`)
    } catch (error) {
      deps.log(
        `judge ${pillar} ${item.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })
}
