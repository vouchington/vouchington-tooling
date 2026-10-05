# Workflow and compiler primitives

`workflow-policy` checks parsed GitHub Actions topology against data supplied by the consumer. It
has no workflow inventory or secret names of its own. Supply a topology shaped like
`WorkflowTopology`; a parser may expose additional fields. Topology, job-graph and concurrency
policy lives in the `no-mistakes` `workflow-topology-policy` rule, not here. This breaking minor removed `evaluateGraphPolicy`, `evaluateLockPolicy`,
`ConcurrencyPolicy` and `WorkflowTopologyPolicy`; migrate to that rule.

```ts
import {
  conditionEntails,
  callerCalleePermissionMismatches,
  parseWorkflow,
  unprovisionedSecretsWithoutReadinessStep,
} from 'vouchington-tooling/workflow-policy'

const diagnostics = [
  ...unprovisionedSecretsWithoutReadinessStep(topology, {
    RELEASE_KEY: { provisioned: false },
  }),
]
const documents = Object.fromEntries(
  Object.entries(workflowSources).map(([path, yaml]) => [path, parseWorkflow(yaml)]),
)
diagnostics.push(...callerCalleePermissionMismatches(topology, documents))
const guardCoversConsumer = conditionEntails('always()', 'failure()')
```

The permission comparison expects documents for every local caller and callable callee in the
topology. The consumer reads workflow files and decides which inventory entries are provisioned;
these functions never fetch secret values. The two-argument permission comparison requires exact
caller/callee grants for compatibility. Consumers that intentionally let a reusable workflow job
inherit the caller's token can opt into the fail-closed inheritance policy:

```ts
callerCalleePermissionMismatches(topology, documents, {
  comparison: 'inheritance-aware',
})
```

This mode requires an explicit caller permission map, rejects malformed declarations and
`write-all`, and permits extra caller grants only when the callee omits top-level permissions and
at least one callee job omits its own permissions. Explicit grants from every callee job still form
required minima that must fit within the caller grants, including jobs guarded by `if`. The strict
scope model follows GitHub's
[workflow permission syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).

Readiness checks rely on the parser's
`secretReferences` at workflow, job, and step scope. A missing required secret is considered ready
only when a preceding guarded `run` step binds it to an env var, checks that var for emptiness,
and exits with status 1. Optional `workflow_call` secrets are exempt.

`compiler-build` records reads from a caller supplied TypeScript-like filesystem host and lets a
caller confirm freshness before reusing a compiled result. The default replays file reads through
the host, which supports virtual and overlay filesystems. Metadata replay is an explicit opt-in for
disk backed reads; use it only when the host returns the same content as the filesystem at that path.
The tracker decorates the supplied host in place, so create a fresh host per build. A snapshot
records unstable repeated reads during capture as well as replay changes.

```ts
import {
  compilerHostProbesAreFresh,
  settleBuild,
  trackCompilerHost,
} from 'vouchington-tooling/compiler-build'

const result = settleBuild(initialOptions, 3, {
  buildAttempt(options) {
    const tracked = trackCompilerHost(createHost(options))
    return { output: compile(options, tracked.host), snapshot: tracked.snapshot() }
  },
  confirmAttempt(options, candidate) {
    return {
      configuration: nextOptions(options),
      settled: compilerHostProbesAreFresh(candidate.snapshot),
    }
  },
})
```

`settleBuild` requires a positive safe integer attempt budget, returns the confirmed build, and
throws after that many unconfirmed attempts. Build and confirmation exceptions propagate.
