---
name: dotnet-test-authoring
description: Add maintainable .NET tests with appropriate unit, app, and integration boundaries.
---

# .NET test authoring

Apply [test-authoring](../test-authoring/SKILL.md).

- Place a test at the narrowest layer that proves the behavior.
- Batch native or external selection where the project requires it.
- Isolate process and filesystem state.
- Assert a serialized contract. Do not assert a private implementation detail.
- Keep a helper typed and reusable only when it removes repeated setup without hiding an
  expectation.
- Keep portable library tests separate from rendered application tests.
- Batch compatible native targets in one selection pass so one shared build validates that source
  set.

Consumer wrapper owns: solution layout, test frameworks, native dependencies, and coverage policy.
