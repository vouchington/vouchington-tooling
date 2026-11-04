import { join } from 'node:path'

import { FinalReviewError, PILLARS, type Finding, type Pillar } from '../finding.mts'
import type { EvalCase } from './cases.mts'
import { currentAssignment, type RawResult } from './judge-all.mts'

/** Pillar findings handed to the verifier, plus the labels derived from the pillar judge. */
export type VerifierInput = {
  findings: Finding[]
  /** Input index of a judged-real finding, and the index of the case expectation it raises. */
  real: Array<[number, number]>
  /** Pairs of (original, planted copy filed under another pillar) the verifier should merge. */
  planted: Array<[number, number]>
}

export type InputDeps = { readFile(path: string): string; exists(path: string): boolean }

function otherPillar(pillar: Pillar): Pillar {
  return pillar === 'design' ? 'correctness' : 'design'
}

/**
 * Gathers every pillar's saved findings for one case from a pillar bench output directory. A
 * finding the judge matched to an expectation is "real"; each real finding gets a planted copy
 * under another pillar to test deduplication. Returns null when no pillar result exists, and
 * throws when a pillar with labels has no current judgement, since its real findings are unknown.
 */
export function collectVerifierInput(
  item: EvalCase,
  findingsFrom: string,
  judgeModel: string,
  deps: InputDeps,
): VerifierInput | null {
  const findings: Finding[] = []
  const real: Array<[number, number]> = []
  let found = false
  for (const pillar of PILLARS) {
    const path = join(findingsFrom, 'raw', pillar, `${item.id}.json`)
    if (!deps.exists(path)) continue
    const raw = JSON.parse(deps.readFile(path)) as RawResult
    if ('error' in raw) continue
    found = true
    const offset = findings.length
    findings.push(...raw.findings)
    const targets = item.expected
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.pillar === pillar)
    const assignment = currentAssignment(
      raw,
      targets.map(({ entry }) => entry),
      judgeModel,
    )
    if (assignment === undefined && targets.length > 0) {
      throw new FinalReviewError(`${pillar} findings are not judged by ${judgeModel}.`)
    }
    assignment?.forEach((at, position) => {
      if (at !== null) real.push([offset + at, (targets[position] as { index: number }).index])
    })
  }
  if (!found) return null
  const planted: Array<[number, number]> = real.map(([index]) => {
    const original = findings[index] as Finding
    findings.push({ ...original, pillar: otherPillar(original.pillar) })
    return [index, findings.length - 1]
  })
  return { findings, real, planted }
}
