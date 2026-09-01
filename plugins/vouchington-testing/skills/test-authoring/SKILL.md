---
name: test-authoring
description: Write focused, maintainable tests and test fixtures for application or library behavior.
---

# Test authoring

Use the repository's test conventions and runner skill. Test observable behavior, boundary failures,
and regressions rather than implementation details. Build fixtures through public constructors or
documented helpers; keep data minimal, explicit, and representative. Add a focused failing test
before a behavior change when practical, then run the narrowest relevant test and required checks.

Do not invent project test commands, coverage targets, mock libraries, or integration environments.
A consumer wrapper owns those choices.

Read [core practice](references/core-practice.md) for the shared boundary, completion, and evidence
rules before choosing a runner-specific approach.

Read [tautological tests](references/tautological-tests.md) before finishing any test whose
assertion is not obviously falsifiable by a defect in the code under test.
