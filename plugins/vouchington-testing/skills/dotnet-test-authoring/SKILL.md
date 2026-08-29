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
