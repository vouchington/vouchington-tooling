# Workflow and compiler primitives

`workflow-policy` evaluates parsed GitHub Actions topology against policy supplied by the
consumer. It has no workflow inventory or secret names of its own. Supply a topology and an index
with the structural methods described by `WorkflowTopologyIndex`; a parser may expose additional
fields. `evaluateGraphPolicy` checks inventory, job and edge presence, artifact flow, fan-in,
reusable callers, and step order. `evaluateLockPolicy` takes the consumer's unlocked reasons and
concurrency intent separately. Its scope classifier recognizes GitHub expression references and
reports unsupported contexts.

Inventory compares workflow `jobIds` against each corresponding job's `key`; job IDs may use any
format. Fan-in and caller comparisons ignore ordering of index results.

```ts
import {
  conditionEntails,
  evaluateGraphPolicy,
  evaluateLockPolicy,
  callerCalleePermissionMismatches,
  parseWorkflow,
  unprovisionedSecretsWithoutReadinessStep,
} from 'vouchington-tooling/workflow-policy'

const diagnostics = evaluateGraphPolicy(topology, index, policy)
diagnostics.push(...evaluateLockPolicy(topology, unlockedReasons, concurrencyIntent))
diagnostics.push(
  ...unprovisionedSecretsWithoutReadinessStep(topology, {
    RELEASE_KEY: { provisioned: false },
  }),
)
const documents = Object.fromEntries(
  Object.entries(workflowSources).map(([path, yaml]) => [path, parseWorkflow(yaml)]),
)
diagnostics.push(...callerCalleePermissionMismatches(topology, documents))
const guardCoversConsumer = conditionEntails('always()', 'failure()')
```

The permission comparison expects documents for every local caller and callable callee in the
topology. The consumer reads workflow files and decides which inventory entries are provisioned;
these functions never fetch secret values. Readiness checks rely on the parser's
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
