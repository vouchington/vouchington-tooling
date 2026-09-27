import type { WorkflowJobNode, WorkflowStep, WorkflowTopology } from './types.mts'
import { conditionEntails } from './condition-entailment.mts'
import { stripShellComments } from './shell-comments.mts'

export type SecretInventoryEntry = { readonly provisioned: boolean }

function referencingWorkflowsByName(topology: WorkflowTopology): Map<string, Set<string>> {
  const byName = new Map<string, Set<string>>()
  const paths = new Map(topology.workflows.map((workflow) => [workflow.id, workflow.path]))
  const add = (name: string, path: string): void => {
    const workflows = byName.get(name) ?? new Set<string>()
    workflows.add(path)
    byName.set(name, workflows)
  }
  for (const workflow of topology.workflows)
    for (const name of workflow.secretReferences ?? []) add(name, workflow.path)
  for (const job of topology.jobs) {
    const path = paths.get(job.workflowId) ?? job.workflowId
    for (const name of job.secretReferences ?? []) add(name, path)
    for (const step of job.steps) for (const name of step.secretReferences ?? []) add(name, path)
  }
  return byName
}

/**
 * True when `workflowPath` is the callee of a `workflow_call` contract that declares
 * `secretName` as `required: false`. GitHub Actions itself never fails such a job for a
 * missing secret, and the callee is responsible for its own graceful-degradation branching —
 * so this class is exempt from the early-fail readiness-step requirement below.
 */
function isOptionalCalleeContractSecret(
  topology: WorkflowTopology,
  workflowPath: string,
  secretName: string,
): boolean {
  const workflow = topology.workflows.find((candidate) => candidate.path === workflowPath)
  if (!workflow?.callable) return false
  return workflow.workflowCall?.secrets?.[secretName]?.required === false
}

/** True when `step` itself references `secretName` (e.g. `${{ secrets.NAME }}` anywhere in it). */
function stepReferencesSecret(step: WorkflowStep, secretName: string): boolean {
  return (step.secretReferences ?? []).includes(secretName)
}

/** True when `job` itself references `secretName`, at job or step scope. */
function jobReferencesSecret(job: WorkflowJobNode, secretName: string): boolean {
  if ((job.secretReferences ?? []).includes(secretName)) return true
  return job.steps.some((step) => stepReferencesSecret(step, secretName))
}

/**
 * True when `secretName` is referenced only at workflow scope (a top-level `env:`) in
 * `workflowPath` — every job in that workflow inherits the value, so none of them necessarily
 * shows a job- or step-scoped reference of its own.
 */
function workflowScopeReferencesSecret(
  topology: WorkflowTopology,
  workflowPath: string,
  secretName: string,
): boolean {
  const workflow = topology.workflows.find((candidate) => candidate.path === workflowPath)
  return (workflow?.secretReferences ?? []).includes(secretName)
}

/**
 * True when some step in `job` fails the job early if `secretName` is unset. A step counts
 * only when it both (a) binds `${{ secrets.NAME }}` to an env var in a `run:` step, and
 * (b) tests that *same env var name* for emptiness (`-z "$VAR"` / `-z "${VAR..."`) with an
 * `exit 1` following shortly after outside of comments, matching the repo's dedicated
 * readiness-step convention. Requiring the emptiness test to name the exact bound var — not just
 * "some exit 1 appears somewhere in this step" — matters because a step can legitimately consume
 * the secret while also containing unrelated `exit 1` calls for other validations. Such an exit is
 * not a readiness check for the secrets the step separately binds. Matches on the env var *name*
 * only — never on any
 * resolved value, since workflow YAML never holds one.
 *
 * Also requires the guarding step to be at or before every other step in the job that references
 * `secretName` (by `step.index`, not array position), and that its own `if:` condition is
 * entailed by (guaranteed to hold whenever) each such consumer step's own condition — see
 * `conditionEntails`. Without the ordering check, an earlier unguarded step could already consume
 * the secret before a later step's readiness check ever executes; without the entailment check, a
 * guard step whose condition is narrower than a consumer's (e.g. gated on an extra clause the
 * consumer doesn't require) could be skipped on a path where the consumer still runs.
 */
function hasReadinessStep(
  job: WorkflowJobNode,
  secretName: string,
  hasScopeAboveStep: boolean,
): boolean {
  const escapedName = secretName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const secretExpression = new RegExp(`\\$\\{\\{\\s*secrets\\.${escapedName}\\s*\\}\\}`)
  const stepConsumers = job.steps.filter((step) => stepReferencesSecret(step, secretName))
  // A readiness step must bind `${{ secrets.NAME }}` itself to check it, so it always appears in
  // `stepConsumers` — that alone must never narrow `consumers` to just the guard when the secret
  // is also reachable at job/workflow scope, since another step could consume it without its own
  // reference and evade the guard. Only narrow when every reference in this job is step-scoped.
  const consumers = hasScopeAboveStep || stepConsumers.length === 0 ? job.steps : stepConsumers

  return job.steps.some((step) => {
    const boundVarNames: string[] = []
    for (const [varName, value] of Object.entries(step.env ?? {})) {
      if (secretExpression.test(value)) boundVarNames.push(varName)
    }
    if (boundVarNames.length === 0) return false

    const executable = stripShellComments(step.run ?? '')
    const guards = boundVarNames.some((varName) => {
      const emptinessCheck = new RegExp(String.raw`-z\s+"?\$\{?${varName}\b[^"]*"?`)
      const match = emptinessCheck.exec(executable)
      if (!match) return false
      const proximityWindow = 300
      return /exit\s+1\b/.test(executable.slice(match.index, match.index + proximityWindow))
    })
    if (!guards) return false

    const guardCondition = step.condition ?? ''
    return consumers.every(
      (consumer) =>
        consumer.index >= step.index && conditionEntails(guardCondition, consumer.condition ?? ''),
    )
  })
}

function groupJobsByWorkflowPath(topology: WorkflowTopology): Map<string, WorkflowJobNode[]> {
  const pathById = new Map(topology.workflows.map((workflow) => [workflow.id, workflow.path]))
  const jobsByWorkflowPath = new Map<string, WorkflowJobNode[]>()
  for (const job of topology.jobs) {
    const path = pathById.get(job.workflowId) ?? job.workflowId
    const jobs = jobsByWorkflowPath.get(path) ?? []
    jobs.push(job)
    jobsByWorkflowPath.set(path, jobs)
  }
  return jobsByWorkflowPath
}

/**
 * Inventory entries marked `provisioned: false` whose consuming workflow has no
 * early-fail readiness step for that name (excluding the `required: false` callee-contract
 * exemption above). Every job that itself references the secret must have its own readiness
 * step — not just any job in the workflow — so a second, unguarded consumer of the same secret
 * cannot hide behind an unrelated job's preflight check. When the secret is referenced at workflow
 * scope (a top-level `env:`), every job in the workflow is treated as a consumer, since any of them
 * could read the inherited value — regardless of whether some jobs *also* reference the secret
 * directly, since a direct reference elsewhere must never narrow validation away from jobs that
 * only inherit the workflow-scoped value. Each violation names the workflow, secret, and expected
 * shape, so the fix is unambiguous: add a readiness step, or flip `provisioned: true` once the
 * secret is actually provisioned in the consumer's inventory.
 */
export function unprovisionedSecretsWithoutReadinessStep(
  topology: WorkflowTopology,
  inventory: Readonly<Record<string, SecretInventoryEntry>>,
): string[] {
  const referencingWorkflows = referencingWorkflowsByName(topology)
  const jobsByWorkflowPath = groupJobsByWorkflowPath(topology)
  const violations: string[] = []

  for (const [name, entry] of Object.entries(inventory)) {
    if (entry.provisioned) continue
    for (const workflowPath of referencingWorkflows.get(name) ?? []) {
      if (isOptionalCalleeContractSecret(topology, workflowPath, name)) continue
      const jobs = jobsByWorkflowPath.get(workflowPath) ?? []
      // Every job inherits a workflow-scoped `env:` reference, regardless of whether some jobs
      // also reference the secret directly — a direct reference elsewhere in the workflow must
      // never narrow validation away from jobs that only inherit the workflow-scoped value.
      const workflowScoped = workflowScopeReferencesSecret(topology, workflowPath, name)
      const consumingJobs = workflowScoped
        ? jobs
        : jobs.filter((job) => jobReferencesSecret(job, name))
      if (consumingJobs.length === 0) continue
      const guarded = consumingJobs.every((job) => {
        const jobScoped = (job.secretReferences ?? []).includes(name)
        return hasReadinessStep(job, name, workflowScoped || jobScoped)
      })
      if (!guarded) {
        violations.push(
          `${workflowPath}: "${name}" is unprovisioned with no early-fail readiness step ` +
            `(expected a step binding \`secrets.${name}\` to an env var, then ` +
            '`if [ -z "$VAR" ]; then ...; exit 1; fi`)',
        )
      }
    }
  }

  return violations.sort()
}
