# Browser reliability

Use the browser only for browser-owned behavior. Prefer stable accessibility or test-id locators,
scope repeated content, and assert visible outcomes. Never use arbitrary sleeps; wait for a precise
URL, request, response, DOM state, or user-visible completion signal.

Seed deterministic data and establish authentication through supported fixtures. Mock network only
for third-party behavior, fault injection, streaming, or conditions impossible to seed. Register
response waits before triggering mutations, and make each scenario independent of prior state.
