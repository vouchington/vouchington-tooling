import { resolveRunsOn } from './matrix.mts'
import type {
  ExactLabelJobs,
  RequiredJob,
  RestrictedLabel,
  RunnerPolicyViolation,
} from './types.mts'
import { hasNonEmptyServices, stepUses, type ParsedWorkflow } from './workflow.mts'

export type Workflows = ReadonlyMap<string, ParsedWorkflow>

const missingWorkflow = (
  policy: RunnerPolicyViolation['policy'],
  workflow: string,
): RunnerPolicyViolation => ({
  policy,
  workflow,
  message: `configured workflow "${workflow}" was not discovered`,
})

export function requiredJobViolations(
  required: readonly RequiredJob[],
  workflows: Workflows,
): RunnerPolicyViolation[] {
  return required.flatMap(({ workflow, job, runsOn }) => {
    const parsed = workflows.get(workflow)
    if (parsed === undefined) return [missingWorkflow('required-jobs', workflow)]
    const found = parsed.jobs.get(job)
    const base = { policy: 'required-jobs' as const, workflow, job }
    if (found === undefined) return [{ ...base, message: 'required job is missing' }]
    const resolved = resolveRunsOn(found)
    if (resolved.kind === 'literal' && resolved.label === runsOn) return []
    return [{ ...base, message: `required job must use literal runs-on "${runsOn}"` }]
  })
}

/** Labels a job runs on: a literal label, every resolvable matrix candidate, or none. */
function jobLabels(job: Parameters<typeof resolveRunsOn>[0]): string[] {
  const resolved = resolveRunsOn(job)
  if (resolved.kind === 'literal') return [resolved.label]
  return resolved.kind === 'matrix' ? resolved.candidates : []
}

export function exactSetViolations(
  rules: readonly ExactLabelJobs[],
  workflows: Workflows,
): RunnerPolicyViolation[] {
  return rules.flatMap(({ label, jobs }) => {
    const out: RunnerPolicyViolation[] = []
    for (const workflow of new Set(jobs.map((entry) => entry.slice(0, entry.indexOf('#'))))) {
      if (!workflows.has(workflow)) out.push(missingWorkflow('exact-label-jobs', workflow))
    }
    const actual = new Set<string>()
    for (const [workflow, parsed] of workflows) {
      for (const [id, job] of parsed.jobs) {
        if (job.uses === undefined && jobLabels(job).includes(label))
          actual.add(`${workflow}#${id}`)
      }
    }
    const expected = new Set(jobs)
    const entry = (policyJob: string, message: string): RunnerPolicyViolation => {
      const split = policyJob.indexOf('#')
      const workflow = policyJob.slice(0, split)
      const job = policyJob.slice(split + 1)
      return { policy: 'exact-label-jobs', workflow, job, message }
    }
    for (const job of expected) {
      if (!actual.has(job)) out.push(entry(job, `expected to run on "${label}" but does not`))
    }
    for (const job of actual) {
      if (!expected.has(job)) out.push(entry(job, `runs on "${label}" but is not in the exact set`))
    }
    return out
  })
}

export function restrictedViolations(
  rules: readonly RestrictedLabel[],
  workflows: Workflows,
): RunnerPolicyViolation[] {
  const out: RunnerPolicyViolation[] = []
  for (const { label, forbidServices, forbiddenActions } of rules) {
    for (const [workflow, parsed] of workflows) {
      for (const [id, job] of parsed.jobs) {
        const resolved = resolveRunsOn(job)
        if (job.uses !== undefined || resolved.kind !== 'literal' || resolved.label !== label) {
          continue
        }
        const base = { policy: 'restricted-label' as const, workflow, job: id }
        if (forbidServices && hasNonEmptyServices(job)) {
          out.push({ ...base, message: `"${label}" jobs must not declare services` })
        }
        for (const action of stepUses(job)) {
          const matched =
            forbiddenActions.prefixes.some((prefix) => action.startsWith(prefix)) ||
            forbiddenActions.contains.some((part) => action.includes(part)) ||
            forbiddenActions.exact.includes(action)
          if (matched) {
            out.push({ ...base, message: `"${label}" jobs must not use action "${action}"` })
          }
        }
      }
    }
  }
  return out
}
