---
'vouchington-tooling': minor
---

Extend `vouchington-tooling/playwright-config` and `vouchington-tooling/playwright`:

- Add `banOverrides` option to `createPlaywrightTimeoutGuard` so callers can reject all `test.setTimeout`, `info.setTimeout`, and `describe.configure({ timeout })` overrides regardless of value while keeping project configuration and fixture tuple budgets under `maxTimeoutMs`.
- Export `createPlaywrightConfig`, `CreatePlaywrightConfigOptions`, `DEFAULT_PLAYWRIGHT_USER_AGENT`, `loggedShellCommand`, `LoggedShellCommandOptions`, and `playwrightWebServerLogDir` from `vouchington-tooling/playwright-config`, and add optional `env` to `CreateReporterOptions`.
- Export `clearCookiesPreservingLocalStorage`, `removeLocalStorageKeys`, `removeLocalStorageKeysBeforeNavigation`, and `resetAnonymousBrowserStateBeforeNavigation` from `vouchington-tooling/playwright`.
