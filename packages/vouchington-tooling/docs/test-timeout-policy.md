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

## Browser boundary

Qualification covers Node Vitest 5 runners. BrowserTestRunner ignores config.runner
and extends the public TestRunner constructor; the current export-star facade does
not guard that constructor. Browser runner routing, prebundling and hook registration
closure are unqualified. This module must not be described as protecting every browser
case. A public constructor guard and explicit virtual export are a separate proposal
requiring actual browser qualification before adoption.
