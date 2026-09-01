---
name: playwright-authoring
description: Author reliable Playwright browser tests, fixtures, selectors, and user flows.
---

# Playwright authoring

Use stable, accessible locators and assert user-observable outcomes. Establish data, authentication,
and server state through supported fixtures or APIs; do not rely on test ordering or arbitrary waits.
Keep each scenario independently repeatable, use auto-waiting assertions, and capture diagnostics on
failure. Prefer browser coverage for real browser interactions rather than duplicating unit tests.

Consumer wrappers own environments, credentials, personas, fixtures, and suite commands.

Read [browser reliability](references/browser-reliability.md) for locator, waiting, state, and network rules.

Read [tautological tests](../test-authoring/references/tautological-tests.md) before finishing any
assertion that is not obviously falsifiable by a defect in the flow under test.
