import { resolveRunsOn } from './matrix.mts'
import {
  exactSetViolations,
  requiredJobViolations,
  restrictedViolations,
  type Workflows,
} from './rules.mts'
import type { RunnerPolicyConfig, RunnerPolicyViolation, WorkflowInput } from './types.mts'
import { parseWorkflowInput, type ParsedWorkflow } from './workflow.mts'

function allowedLabelViolations(
  workflows: Workflows,
  allowed: readonly string[],
): RunnerPolicyViolation[] {
  const out: RunnerPolicyViolation[] = []
  for (const [workflow, parsed] of workflows) {
    for (const [job, body] of parsed.jobs) {
      const base = { workflow, job }
      if (body.uses !== undefined) {
        if (body['runs-on'] !== undefined) {
          out.push({
            ...base,
            policy: 'reusable-delegate',
            message: 'reusable-workflow delegate must not set runs-on',
          })
        }
        continue
      }
      const resolved = resolveRunsOn(body)
      const policy = 'allowed-labels' as const
      if (resolved.kind === 'invalid') {
        out.push({ ...base, policy, message: resolved.reason })
        continue
      }
      const labels = resolved.kind === 'literal' ? [resolved.label] : resolved.candidates
      for (const label of labels.filter((candidate) => !allowed.includes(candidate))) {
        out.push({ ...base, policy, message: `runs-on label "${label}" is not allowed` })
      }
    }
  }
  return out
}

/**
 * Evaluates every configured runner policy over supplied workflow files. Fails closed: empty
 * input, unparseable workflows and config entries naming undiscovered workflows are violations.
 */
export function evaluateRunnerPolicy(
  inputs: readonly WorkflowInput[],
  config: RunnerPolicyConfig,
): RunnerPolicyViolation[] {
  if (inputs.length === 0) {
    return [{ policy: 'discovery', message: 'no workflow files were discovered' }]
  }
  const violations: RunnerPolicyViolation[] = []
  const workflows = new Map<string, ParsedWorkflow>()
  for (const input of inputs) {
    const parsed = parseWorkflowInput(input)
    if (parsed.ok) workflows.set(input.path, parsed.workflow)
    else violations.push({ policy: 'parse', workflow: input.path, message: parsed.message })
  }
  return [
    ...violations,
    ...allowedLabelViolations(workflows, config.allowedLabels),
    ...requiredJobViolations(config.requiredJobs, workflows),
    ...exactSetViolations(config.exactLabelJobs, workflows),
    ...restrictedViolations(config.restrictedLabels, workflows),
  ]
}

export function formatRunnerPolicyViolation(violation: RunnerPolicyViolation): string {
  const where = [violation.workflow, violation.job].filter(Boolean).join('#')
  return `${where === '' ? '' : `${where}: `}${violation.message} [${violation.policy}]`
}
