# Configuration inventory

Import `collectConfigInventory` and `formatConfigInventoryMarkdown` from
`vouchington-tooling/config-inventory`. The collector reads caller-selected source text; it never
imports or executes repository modules. The result is JSON-compatible data.

```ts
const inventory = collectConfigInventory(
  { trackedFiles, readTrackedFile },
  {
    describeFile(file) {
      if (file.endsWith('.test.ts')) return null
      if (file === 'ops/environment.md') return { markdown: true, referenceBuckets: ['docs'] }
      if (file === 'config/workspace.yaml') return { packageManagerConfig: true }
      if (file.startsWith('edge/')) return { workerBindings: true }
      return {}
    },
    envContract: [{ name: 'SERVICE_TOKEN', sensitivity: 'secret', runtimeSurfaces: ['api'] }],
    envConstants: new Map([['TOKEN_ENV', 'SERVICE_TOKEN']]),
    envHelperNames: ['readRequiredEnv'],
    sensitivityOrder: ['internal', 'public', 'secret'],
  },
)
const json = JSON.stringify(inventory, null, 2)
const markdown = formatConfigInventoryMarkdown(inventory)
```

`describeFile` owns exclusions, generated artifacts, and repository layout. Each non-null result
enables ordinary `process.env` and local wrapper discovery. File roles additionally enable Worker
bindings, environment assignments, exported shell assignments, JSON bindings, Docker ARG/ENV,
workflow `env:` maps, Markdown code names, and package-script assignments. Only files marked
`packageManagerConfig` are parsed for pnpm package gates. `referenceBuckets` attaches known names to
documentation, deployment, workflow, local setup, or package-gate evidence. Discovery finishes before
reference collection, so file order does not lose references to subsequently discovered names.

`readTrackedFile` returns a string or null for missing/non-text content. Errors propagate instead of
producing a silently incomplete inventory. The collector deduplicates file paths and sorts output.
It does not read an environment variable's actual value. Package-gate values describe dependency
policy and may include package names, versions, or paths; consumers own report access policy.

Supply `collectDynamicConfigs(file, source)` to return `{ namespace, kind }` references, with kind
`definition` or `registry`. The library merges evidence; consumer constructor names, key prefixes,
and registry formats stay outside it. Supply `annotateEnv(row)` for classifications and a review
reason. No classification or documentation enforcement runs by default.

Environment contract metadata accumulates keys and runtime surfaces. The first contract key and
source-of-truth are retained as primary values. Sensitivity defaults to `internal < public < secret`;
`sensitivityOrder` accepts any caller taxonomy from least to most sensitive. Unknown labels retain
their first value until a recognized higher rank is supplied. Markdown includes source-of-truth and
Docker build-argument evidence alongside other row fields; JSON remains the machine-readable form.

Discovery is a conservative syntax scan, not a TypeScript data-flow analysis. Supported local
wrappers are function declarations with direct indexed environment reads. A destructured parameter
before the env-name parameter retains its argument position, but destructured values are not
analyzed. Dynamic names without supplied constants cannot be enumerated. Arbitrary comments or
strings may look like syntax. Use the result as review evidence rather than a security proof or
exhaustive runtime dependency graph. YAML parse failures produce no package-gate rows for that file.

See the [package README](../packages/vouchington-tooling/README.md) for other libraries.
