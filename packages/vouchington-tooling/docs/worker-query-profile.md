# Worker query profiles in tests

The `worker-query-profile` subpath supplies test instrumentation over the public PostgreSQL query
profiles and worker-runtime testing APIs. Install the optional peer packages when using it.

```ts
import { createQueryProfiles } from '@vouchington/postgres/query-telemetry'
import { createWorkerQueryProfileHelpers } from 'vouchington-tooling/worker-query-profile'

const profiles = createQueryProfiles()
const helpers = createWorkerQueryProfileHelpers({
  profiles,
  recordViolation: (message) => violations.push(message),
  recordKind: 'test-worker',
  diagnosticsEnvVar: 'TEST_QUERY_DIAGNOSTICS',
})
const restore = helpers.install()
```

`install()` composes the existing global test processor decorator inside the profiling decorator.
SDK runtime factories then profile single and batch processors. Its cleanup restores the previous
decorator only while the installed decorator still owns the global slot. Repeated installs from
the same helpers share one decorator; their idempotent cleanup functions release it when the last
installation is released.

`helpers.wrapProcessor(processor, queue, observer?)` also profiles a standalone processor. Its
optional owner observer is preserved when the processor is adapted into a Worker. Owner failures
are captured by the SDK without suppressing instance observers or replacing the business outcome.

Use `helpers.Worker` as the testing Worker adapter for direct construction or the test alias of the
factory's Worker import. It delegates execution, scheduling, options, and lifecycle to the SDK. Each
worker offers `observeQueryProfiles(observer)`, returning an unsubscribe function. The observer must
return `undefined`; asynchronous observers are unsupported. Factory-decorated processors retain
their original profile owner, even after module resets, without a second profiling scope. Caller
processor wrappers run inside profile collection. Distinct decorated processors keep separate
observers even when their queue and business processor are shared.

By default every job must have a nonempty string `id` and `name`; a batch must be nonempty and all
members must pass validation before business work starts. Supply `identities` for a different input
shape. This callback must return complete job identities or throw before invocation.

Diagnostics are emitted as one JSON line when the configured environment variable equals `1`, or
when reporting failures occur. `output` can replace stderr. Observer and output failures are
recorded on the profile and sent to the injected violation collector. A failed collector is recorded
as another reporting failure. Reporting preserves business results and errors. Consumers own the
collector and choose when accumulated violations fail their tests.
