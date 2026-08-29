# Mock boundaries

Mock providers, transports, clocks, and environment boundaries rather than application modules.
When a module mock is necessary, preserve its runtime export shape, type the factory against the
real module, and spread actual exports unless omission is intentional. Update static factories when
the mocked module gains an export.

Prefer spies or dependency injection for a narrow seam. Restore mocks, environment, and globals
after each test so a test cannot alter another test's module graph or process state.
