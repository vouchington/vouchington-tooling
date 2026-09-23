# Dependency boundaries

Test the code this repository owns. A dependency's behavior — its algorithms, error messages, output
formats, internal file layout, exit codes, the URLs and query strings it builds, its pagination and
retry strategy, and the order or number of calls it makes — belongs to that dependency's own tests.
An assertion that pins any of it fails when the dependency ships a release rather than when this
repository regresses, so every upgrade arrives as a red build that no change here caused.

Apply the [tautological tests](tautological-tests.md) falsifiability check with ownership added: for
every assertion, name a defect in this repository's code that would make it fail. If only a
dependency release could fail it, delete it. If it covers owned logic but also pins incidental
dependency detail, rewrite it to assert the owned outcome. Configuration the repository chooses —
which rules it enables, its thresholds and scopes, and the arguments it passes to a dependency — is
owned, so test it, but through the dependency's public API rather than its internals.

Watch for these shapes. A version-drift guard deep-imports a package's private files or calls its
internal functions so the suite notices when upstream behavior changes; it couples the suite to a
layout the package never promised, so delete it, and when documentation relies on dependency
behavior, link to the dependency's own documentation instead of restating and pinning it. A
dependency re-test runs a dependency with fabricated input and asserts what it returns; a wrapper
that only forwards configuration needs one test proving the configuration arrives, not a second copy
of the dependency's suite. An upstream-output pin asserts exact dependency-owned messages, markdown,
JSON envelopes, or renderer markup when the owned contract is narrower; assert the rule identifier,
status, or owned field instead. A sequence-bound fake answers by call order — chained one-shot mock
responses, or a queue of canned replies consumed in turn — when the code under test does not own
that order, so a dependency that adds a request, paginates differently, or reorders its calls hands
the wrong reply to the wrong call; route the fake by request meaning, such as method and pathname,
and assert the owned result rather than the exact URL, query string, or call count.

When a dependency upgrade breaks a test, first ask whether the test pinned dependency behavior. If
it did, fix the test by deleting or rewriting it rather than re-pinning the new upstream value, and
do not add a guard that fails on the next release. If the failure traces to owned code or owned
configuration — the dependency now rejects arguments this repository passes, or returns a result
this repository's logic mishandles — it is a real regression, so fix the owned code instead.
