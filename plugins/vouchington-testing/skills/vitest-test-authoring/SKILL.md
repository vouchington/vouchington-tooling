---
name: vitest-test-authoring
description: Apply Vitest-specific patterns when adding or changing Vitest tests, mocks, or fixtures.
---

# Vitest test authoring

Apply [test-authoring](../test-authoring/SKILL.md) first.

- Isolate tests with Vitest lifecycle hooks. Restore spies and globals after each test.
- Prefer a deterministic async assertion over a timing wait.
- Mock an external boundary. Do not mock the module under test.
- Use a typed factory when the project supplies one.
- Run the selected file or project before broader validation.
- Read [mock boundaries](references/mock-boundaries.md) when adding a module mock or changing an
  export.

Consumer wrapper owns: project selection, mock boundaries, fixture names, and coverage policy.
