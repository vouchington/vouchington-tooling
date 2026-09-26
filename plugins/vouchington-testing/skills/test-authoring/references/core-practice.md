# Core test practice

- Choose the lowest realistic boundary that can observe the contract.
- Mock an external system or uncontrolled infrastructure. Exercise internal module composition where
  that is practical.
- Test behavior, failure paths, authorization, and security-relevant validation. Do not reach it
  through a private call. Assert what this repository owns, not what its
  [dependencies](dependency-boundaries.md) produce.
- Start with a failing test when the behavior is testable.
- Finish only when the production path, its public contract, documentation, and generated artifacts
  move together. Do not leave a placeholder or a test-only production branch.
- For every acceptance criterion, keep evidence from a focused test, a review, or an explicitly
  justified manual check. Evidence counts only when it is falsifiable. Confirm the assertion is not
  [tautological](tautological-tests.md) before treating it as coverage.
