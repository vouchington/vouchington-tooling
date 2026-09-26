---
name: storybook-authoring
description: Add maintainable Storybook stories and browser-mode component coverage.
---

# Storybook authoring

Apply [test-authoring](../test-authoring/SKILL.md).

- Show a meaningful supported state with realistic args and fixtures.
- Keep story data local and deterministic.
- Expose an important visual or interaction variant.
- Add browser-mode coverage where it catches behavior a unit test cannot see.
- Do not use a story as end-to-end setup or as production data handling.
- Read [component coverage](references/component-coverage.md) for direct stories and browser
  isolation.

Consumer wrapper owns: Storybook configuration, exclusions, visual baselines, and commands.
