---
name: test-authoring
description: Write focused, maintainable tests and test fixtures for application or library behavior.
---

# Test authoring

Use the repository's test conventions and the matching runner skill.

- Test observable behavior, boundary failures, and regressions. Do not test implementation details.
- Build fixtures through public constructors or documented helpers. Keep data minimal, explicit, and
  representative.
- Add a focused failing test before a behavior change when that behavior can be tested. Then run the
  narrowest relevant test and the required checks.
- Read [core practice](references/core-practice.md) before choosing a runner-specific approach.
- Read [tautological tests](references/tautological-tests.md) before finishing a test whose
  assertion
  is not obviously falsifiable by a defect in the code under test.
- Read [dependency boundaries](references/dependency-boundaries.md) before asserting on anything a
  dependency produces, and whenever a dependency upgrade breaks a test.

Consumer wrapper owns: project test commands, coverage targets, mock libraries, and integration
environments.
