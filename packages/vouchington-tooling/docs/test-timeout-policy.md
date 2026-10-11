# Configured test deadline policy

This module validates positive finite configured deadlines at or below an inclusive
maximum (30,000 ms by default). It does not turn the aggregate JSON/JUnit duration,
including setup and teardown, into a single test deadline. Hooks have separate deadlines;
Vitest test fixtures execute within their enclosing test deadline. A synchronous blocked event loop requires the existing
outer process deadline and cleanup; an in-process timer cannot preempt it.

## Current Vitest 5 Node integration contract

Call `protectRunnerTimeouts(this)` after the existing custom runner's constructor.
It preserves the runner instance and delegates its existing `extendTaskContext`
implementation. Its configuration accessors validate before collection and on writes,
including native `vi.setConfig` writes to that same resolved configuration object.
Completion-hook registration is protected when the context is created.
The original `context.task.timeout` is checked before and after delegating to the existing
extension. Vitest 5 constructs its timeout wrapper after creating the context, using
a local deadline captured before context creation. Early validation prevents masking
that deadline; the second check prevents invalidating the original task metadata.
This also protects tests registered through raw native imports. Hook registration
requires the import-routing layer because hooks do not create test contexts there.

Install `testTimeoutPolicyPlugin(30000, registrationPackages)` in each owning Vite/Vitest config. It routes
public `vitest` imports from consumer modules through `guardVitestExports(nativeVitest)`
without parsing consumer source or modifying installed SDK files. This facade validates
test, inherited suite and hook deadlines before native registration
creates timeout wrappers. Conditional, curried and concurrent APIs preserve their
function call behavior; aliased runtime setters validate the actual configuration
object when called. This module does not parse source or silently clamp deadlines.
List every package that registers tests or hooks in `registrationPackages`; the plugin
inlines these packages through Vitest's public server dependency configuration.
Externalized modules bypass Vite resolution entirely. Transformed helper imports
under `node_modules`, including preserved symlinks, are routed through the facade.
This list must include transitive registrar packages reached through helper re-exports,
not just direct imports. Before consumer adoption, audit each owning configuration's
existing upstream module/export/alias graph and record its complete registration
package list. This plugin does not discover that graph. An omitted externalized
registrar can register raw hooks even when every child test has a legal deadline.
Extended and overridden fixture APIs retain guarded test registration. Vitest fixture
options are not treated as having an independent timeout field that its SDK does not support.

Both pieces are required. A task-entry runner check is too late to change timeout
values captured during registration. The facade alone does not validate resolved
standalone project configuration. Consumer integration must cover every project,
custom runner, standalone config and test import/re-export. Globals mode is rejected;
the current integration uses public imports. Unguarded
imports or globals leave an adoption gap. Import enforcement belongs in an upstream
analyzer, not an additional product-owned parser.

## Regression boundaries

Native child tests in `src/test-timeout-policy/native.test.mts` cover rejected collection,
opaque aliased runtime configuration, resolved standalone configuration, completion
hooks, extended fixture APIs, the inclusive ceiling and native short-hang termination.
They exercise the plugin using ordinary public test imports and the composed runner.

`registration-matrix.test.mts` exercises actual SDK children for shuffled suites with
legal child overrides, test.for, suite.each/for, override/scoped, and file/worker fixture
setup/teardown. Vitest 5 accepts test/file/worker scopes; suite is an unsupported
fixture scope whose native rejection must remain intact. Transitive helper probes
cover a listed registrar and explicitly demonstrate the omitted-package adoption gap.
The two focused suites cover 64 cases with 66 child launches. The independent shuffle
regression fails when the original omission is restored and passes with the guard.

The child fixture observes close/error before ownership capture, attempts bounded
close and group drain even after capture/watchdog failure, and preserves original
errors alongside cleanup diagnostics. Artifacts are read only after close and drain;
undrained resources are retained and fail qualification. Linux ownership checks do
not provide an atomic pidfd guarantee. The deliberate blocked-loop control is the
only qualified forced-cleanup child; ordinary children must exit without it.

## Final-constructor Node composition

The plugin's optional third argument is `NodeRunnerPolicy`, with `runner` set to the
absolute resolved module of the existing final custom runner, or null for the native
runner. That module must default-export the actual final constructor. Preserve its
public lifecycle methods and own fields; do not substitute its base class.

```ts
plugins: [
  testTimeoutPolicyPlugin(30_000, registrationPackages, {
    runner: absoluteFinalRunnerModule,
  }),
]
```

The plugin config hook supplies an owned absolute virtual runner module. Its default
export wraps the final constructor with `guardPublicRunner`, so derived fields and
private brands initialize before configuration and context protection is installed.
The Node import facade leaves public TestRunner native, avoiding premature base
installation while guarding registration APIs. The resolved config hook rejects a
later runner replacement or a browser project. Existing configured runner provenance
must match the explicitly supplied absolute module; inspect every project/standalone
config and merged plugin graph before adoption. Real SDK children qualify worker serialization/import resolution, final derived own fields,
private receivers, the native runner route and standalone project configuration. Vitest
5.0.3 rejects the unsupported `--runner` CLI option itself; merged runner replacements
are rejected by the policy.

`guardPublicRunner`, `RunnerConstructor`, and `Protector` are public exports of
`vouchington-tooling/test-timeout-policy`. The wrapper retains its generic constructor
type, static properties and native newTarget/instance receivers. Direct callers must
wrap the final class; wrapping a base class does not finalize derived own fields.

## Browser and Storybook routing

Browser projects ignore `config.runner`. `browserTestTimeoutPolicyPlugin` instead
explicitly exports the guarded public `TestRunner` constructor through the Vitest
facade. Public Vite environment hooks and the public `onBrowserInit` reporter
lifecycle remove registrar bundles from effective client dependency optimization,
including nested `dependency > package/subpath` entries. Existing reporters,
unrelated entries and package near-prefixes are preserved. No installed SDK file
is modified and no SDK-private API is imported.

Actual Vitest 5.0.3 Browser Mode children run through the public Playwright provider
and normal Chromium installation. They verify tester import routing and optimizer
configuration at real client transforms after SDK aggregation, and reject invalid
constructor configuration, aliased runtime setters and package hook deadlines.
Playwright is the browser provider here; this is not qualification of Playwright
Test's own case and hook timeout policy.

Actual Storybook 10.6.1 addon fixtures generate tests from a real CSF story and preview
annotations. Generated and stable annotation setup variants exercise aliased
transitive package hook registrations and verify rendered content and annotation
completion. The stable replacement uses the public preview API and the real
builder-generated project annotation module. Missing addon setup is rejected;
unrelated setup files are preserved. These fixtures qualify the prepared synthetic
registrar graph, not every consumer story, project or dependency graph.

Node qualification retains the original 64 cases/66 child launches and adds actual
final-runner worker routes and public-constructor contracts. Parent-worker contracts
cover reporter composition, final client optimizer cleanup, constructor identity,
configuration mutation and custom extension receivers. Whole-module qualification
runs the original tests and additions together against unchanged coverage thresholds:
100% statements, functions and lines; 95% branches. Full-repository coverage and
normal publication gates must pass independently before publishing these changes.

Before consumer adoption, audit and supply the complete direct and transitive
registrar inventory for every effective project, standalone configuration, custom
runner and browser configuration. Source routing alone does not discover this
closure. Omitted externalized registrars remain an explicit adoption gap. The
consumer's maximum-30-second requirement applies separately to every effective
Vitest and Playwright Test case, including resolved configuration and runtime writes;
this Vitest module cannot certify the separate Playwright Test integration.

All typed Oxlint and tsgolint launchers and children must inherit `GOMEMLIMIT=8GiB`.
The Go heap target is not a hard process RSS limit. Source and fixture configuration
files belong to explicit TypeScript project roots so typed analysis does not fall
back to an unintended inferred project.
