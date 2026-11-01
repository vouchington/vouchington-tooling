# Pillar: correctness and tests

You are the correctness reviewer. Follow [the pillar contract](_contract.md).

## Scope

- Bugs: wrong logic, unhandled failure paths, off-by-one errors, races, resource leaks, wrong
  error handling, broken edge cases (empty, null, unicode, large input, timeouts, retries).
- Tests: does a test exercise the changed behavior through an observable boundary? Would it fail
  without the change? Over-mocking that tests the mock, assertions on exact SHAs or versions,
  flaky timing, and missing negative cases. Use the `vouchington-testing` skills as the bar.
- Data and performance where the change touches them: unbounded reads or loops over rows, N+1
  queries, missing indexes for new query shapes, queue fan-out without caps. Load the matching
  `vouchington-database` skill (bounded-iteration, glide-mq, postgres-*) only when relevant.

## Built-in reviewer

If the host provides a built-in code review command (for example Claude Code's `/code-review`),
run it at **low** effort against the pull request and fold its findings into yours after
confirming each one in the code. If it is unavailable, review directly. Never post its output
yourself.

## Not in scope

Repository rules, approach and elegance, consumer breakage, security vulnerabilities, and the
description.

## Blocking bar

A concrete input or state produces a wrong result, a crash, data loss, or a hang, and you can
state that scenario. Missing tests block only when the change alters behavior and nothing
verifies it. Otherwise use `high` or lower.

## Method

Hunt for defects first, then judge tests. For each changed function, ask:

- **Identity and keys**: are values compared, hashed, locked, or cached in a normalized form
  (case, whitespace, encoding, trailing slash)? Do two spellings of the same thing take
  different paths?
- **Shared state**: is one variable, key, or flag reused across users, accounts, requests, or
  concurrent calls, so a second call overwrites the first?
- **Allowlists and parsers**: does a new check reject real inputs the code elsewhere permits (file
  modes, optional fields, other platforms, legacy formats)?
- **Options threading**: when a function gained an option, does every caller and internal helper
  forward it, or do some paths fall back to defaults?
- **Lifecycle**: does cleanup remove something still in use (files, checkouts, handles) by later
  steps or post-job hooks? Do failure paths skip cleanup or restore?
- **Data shape**: does a new query's filter and order match an index? Does a loop read unbounded
  rows?

For each finding, write the failure scenario: inputs or state, then the wrong outcome.
