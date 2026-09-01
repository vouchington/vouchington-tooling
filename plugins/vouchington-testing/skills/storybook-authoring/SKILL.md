---
name: storybook-authoring
description: Add maintainable Storybook stories and browser-mode component coverage.
---

# Storybook authoring

Create stories that show meaningful supported states with realistic args and fixtures. Keep story
data local and deterministic, expose important visual or interaction variants, and add browser-mode
coverage where it catches behavior unavailable to unit tests. Do not use stories as a substitute for
end-to-end setup or production data handling.

Consumer wrappers own Storybook configuration, exclusions, visual baselines, and commands.

Read [component coverage](references/component-coverage.md) for direct stories and browser isolation.

Read [tautological tests](../test-authoring/references/tautological-tests.md) before finishing any
interaction assertion that is not obviously falsifiable by a defect in the component under test.
