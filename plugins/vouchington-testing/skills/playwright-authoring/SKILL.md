---
name: playwright-authoring
description: Author reliable Playwright browser tests, fixtures, selectors, and user flows.
---

# Playwright authoring

Apply [test-authoring](../test-authoring/SKILL.md).

- Use a stable, accessible locator. Assert a user-observable outcome.
- Establish data, authentication, and server state through a supported fixture or API.
- Do not rely on test order or an arbitrary wait.
- Keep each scenario independently repeatable. Use an auto-waiting assertion. Capture diagnostics
  on failure.
- Use the browser for a real browser interaction. Do not repeat a unit test there.
- Read [browser reliability](references/browser-reliability.md) for locator, waiting, state, and
  network rules.

Consumer wrapper owns: environments, credentials, personas, fixtures, and suite commands.
