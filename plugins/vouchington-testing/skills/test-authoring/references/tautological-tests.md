# Tautological tests

A test is tautological when no defect in the code under test could make its assertion fail. Name a
concrete defect the assertion would catch. If none exists, the assertion proves nothing.

A test name is part of the assertion. `it('returns 200')` that never reads the status is the
defect: reviewers trust the name and skim the body.

Shapes, most consequential first:

- Forced-value: the test transforms the result, then asserts the transformed constant.
  `expect(x.then(() => undefined)).resolves.toBeUndefined()` still depends on `x` fulfilling, but
  every fulfillment value collapses to `undefined`. The assertion must depend on the code's output,
  not only on whether it threw. A test named for returned data that never reads that data asserts
  nothing about it.
- Literal: `expect(true).toBe(true)`, and the same shape in other runners (`XCTAssertTrue(true)`,
  `Assert.True(true)`).
- Self-comparison: `expect(x).toBe(x)`.
- Literal echo: the test asserts a value it just wrote. Input and expectation are the same value,
  with no code path between them.
- Mock echo: the assertion checks that a mock returns the value the test configured.
- Re-implementation: the test recomputes the production algorithm and compares the two results, so
  a shared bug cancels out.
- Vacuous range or shape: `expect(x.length).toBeGreaterThanOrEqual(0)`, or `toBeDefined()` /
  `typeof` on a static import or a value the test just constructed. It holds for every output.
- No-assert: the test awaits a call and asserts nothing afterward. It fails only when the call
  throws. An `expect-expect` lint rule flags the missing assertion.

Coverage pressure is the usual cause: a line must be covered and no assertion is obvious.

- When the code returns null or swallows an error for the case under test, assert that exact
  outcome, such as `.toBeNull()` for not-found or a definite non-null shape for found. A
  definedness check still passes if a regression collapses the two paths.
- Otherwise assert the shape of the returned payload.
- Only when neither is available, assert completion alone, such as
  `await expect(run()).resolves.not.toBeInstanceOf(Error)`, and name the test for resolving rather
  than for success or a status code.
- A 403 can execute the same lines as a 200. Do not satisfy a coverage percentage with an
  assertion that cannot fail.

Delete a tautological test when removing it does not reduce coverage. When removal drops coverage,
that test owns those lines: strengthen it in place. A steady coverage number does not show that the
remaining tests check anything.

Consumer repositories may enforce the mechanical shapes above with ast-grep and an `expect-expect`
rule. This document judges the shapes those tools cannot express: a definedness check that needs
dataflow analysis, a mock echo, or a re-implementation. Do not contradict the mechanical rules.
