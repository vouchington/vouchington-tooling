import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

type Job = { uses?: string; 'timeout-minutes'?: number; steps?: { 'timeout-minutes'?: number }[] }

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.github/workflows')

function jobs() {
  return readdirSync(directory)
    .filter((name) => /\.ya?ml$/u.test(name))
    .toSorted()
    .flatMap((name) => {
      const workflow = parse(readFileSync(join(directory, name), 'utf8')) as {
        jobs?: Record<string, Job>
      }
      return Object.entries(workflow.jobs ?? {}).map(([id, job]) => ({ id: `${name}#${id}`, job }))
    })
}

describe('workflow timeout policy', () => {
  it('keeps each job deadline strictly below the sum of its step timeouts', () => {
    const checked = jobs().flatMap(({ id, job }) => {
      const steps = job.steps ?? []
      const timeouts = steps.map((step) => step['timeout-minutes'])
      // A single-step job cannot sit below its only step's timeout, so only multi-step jobs apply.
      if (job.uses || job['timeout-minutes'] === undefined || steps.length < 2) return []
      if (timeouts.some((timeout) => typeof timeout !== 'number')) return []
      const sum = (timeouts as number[]).reduce((total, value) => total + value, 0)
      return [{ id, job: job['timeout-minutes'], sum }]
    })
    expect(checked.length).toBeGreaterThan(0)
    expect(checked.filter(({ job, sum }) => job >= sum)).toEqual([])
  })
})
