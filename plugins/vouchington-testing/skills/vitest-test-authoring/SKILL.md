---
name: vitest-test-authoring
description: Apply Vitest-specific patterns when adding or changing Vitest tests, mocks, or fixtures.
---

# Vitest test authoring

Apply [test-authoring](../test-authoring/SKILL.md) first. Keep tests isolated with Vitest lifecycle
hooks, restore spies and globals after each test, and prefer deterministic async assertions over
timing waits. Mock external boundaries rather than modules under test, and use typed factories when
the project supplies them. Run the selected file or project before broader validation.

Consumer wrappers own project selection, mock boundaries, fixture names, and coverage policy.
