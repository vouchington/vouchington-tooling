---
name: dotnet-test-authoring
description: Add maintainable .NET tests with appropriate unit, app, and integration boundaries.
---

# .NET test authoring

Place tests at the narrowest layer that proves the behavior. Batch native or external selection
where the project requires it, isolate process and filesystem state, and assert serialized contracts
instead of private implementation details. Keep test helpers typed and reusable only when they remove
repeated setup without hiding important expectations.

Consumer wrappers own solution layout, test frameworks, native dependencies, and coverage policy.

Keep portable library tests separate from rendered application tests; batch compatible native targets
in one selection pass so a shared build validates the same source set.

Before finishing an assertion, name a concrete defect in the code under test that would make it fail;
an `Assert.True(true)` or a re-implemented computation compared against itself passes for every input
and proves nothing, so treat [tautological tests](../test-authoring/references/tautological-tests.md)
as a defect even when coverage looks satisfied.
