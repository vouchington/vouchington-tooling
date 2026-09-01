# Tautological tests

A test is tautological when no defect in the code under test could make its assertion fail. Before
trusting an assertion, name a concrete defect it would catch; if none exists, the assertion proves
nothing regardless of how many lines it exercises. A test name is part of the assertion: `it('returns
200')` that never reads the status is itself the defect, since reviewers trust the name and skim the
body instead of checking that it matches what is asserted.

Watch for these shapes, most consequential first. A forced-value tautology transforms the result
before asserting on the transformed constant, as in `expect(x.then(() => undefined))
.resolves.toBeUndefined()`, where the `.then` discards whatever the code produced so the assertion
no longer depends on it — ask whether the assertion still depends on what the code returned; if a
rewrite of the function under test could not change the outcome, the wrapper broke that dependency.
A literal tautology asserts a literal against itself, `expect(true).toBe(true)`, with equivalents in
other runners (`XCTAssertTrue(true)`, `Assert.True(true)`). A self-comparison, `expect(x).toBe(x)`,
and a literal echo that asserts on a value the test itself just wrote fail the same way: the input
and the expectation are the same value with no code path in between. A mock echo asserts that a mock
returns what it was configured to return, exercising the mock's configuration rather than the code
under test. A re-implementation recomputes the production algorithm inside the test and compares the
two computations, so a bug shared by both cancels out invisibly. A vacuous range or shape check —
`expect(x.length).toBeGreaterThanOrEqual(0)`, or a `toBeDefined()`/`typeof` check on a static import
or a value the test just constructed — holds for every possible output. A no-assert test awaits a
call and asserts nothing afterward, covering lines without checking that anything ran correctly.

Coverage pressure is the usual root cause: a line must be covered and no assertion is obvious. Before
reaching for a weak assertion, check whether the code takes a null- or error-swallowing path for the
case under test — a repository-lookup helper that returns `null` instead of throwing for a not-found
condition, for example — and assert the non-null or non-error outcome explicitly, since that null is
exactly the signal a regression would flip. Otherwise assert the shape of the returned payload. Only
when neither is available, fall back to `await expect(run()).resolves.not.toThrow()` paired with a
test name that says "resolves" rather than "succeeds" or "returns 200" — a legitimately weak
assertion, honestly labeled as weak. Satisfying a coverage percentage while asserting nothing is never
acceptable; a 403 executes the same lines as a 200, and coverage tooling cannot tell them apart.

Delete a tautological test if removing it does not reduce coverage; if it does, that test was the sole
owner of that coverage and must be strengthened in place, not deleted, since a steady coverage number
is not evidence the remaining tests check anything real. Consumer repositories may enforce the
mechanical shapes above with ast-grep rules and an `expect-expect` lint rule; this document is the
judgment layer for shapes those tools cannot express, such as a definedness check that needs dataflow
analysis, a mock echo, or a re-implementation — tooling and this guidance should agree, not diverge.
