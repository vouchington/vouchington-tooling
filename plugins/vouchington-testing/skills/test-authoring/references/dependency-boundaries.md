# Dependency boundaries

Test the code this repository owns. The dependency's own tests own its algorithms, error messages,
output formats, internal file layout, exit codes, the URLs and query strings it builds, its
pagination and retry strategy, and the order or number of calls it makes. An assertion that pins
any of that fails on a dependency release, not on a regression here.

Apply the [tautological tests](tautological-tests.md) check with ownership added. Name a defect in
this repository that would fail the assertion.

- If only a dependency release could fail it, delete it.
- If it covers owned logic and also pins incidental dependency detail, rewrite it to the owned
  outcome.

Owned even when a dependency carries it out: enabled rules, thresholds, scopes, arguments,
endpoints, parameters, handling of the dependency's exit codes and errors, and any call count or
order this repository's logic requires. Test those through the dependency's public API.

Shapes:

- Version-drift guard: a deep import of private files, or a call to internal functions, so the
  suite notices an upstream change. Delete it. When docs rely on dependency behavior, link to the
  dependency's docs.
- Dependency re-test: fabricated input asserted against what the dependency returns. A wrapper that
  only forwards configuration needs one test that the configuration arrives.
- Upstream-output pin: an exact dependency-owned message, markdown blob, JSON envelope, or renderer
  markup when the owned contract is narrower. Assert the rule identifier, status, or owned field.
- Sequence-bound fake: one-shot responses, or a queue consumed in call order, when this repository
  does not own that order. An added request, a pagination change, or a reorder then hands the wrong
  reply to the wrong call. Route the fake by request meaning, such as method and pathname. Assert
  the owned result, not an incidental URL, query string, or call count.

When a dependency upgrade breaks a test:

- If the test pinned dependency behavior, delete or rewrite it. Do not re-pin the new value. Do not
  add a guard that fails on the next release.
- If owned code or configuration failed — the dependency rejects arguments this repository passes,
  or returns a result this repository mishandles — fix the owned code.
