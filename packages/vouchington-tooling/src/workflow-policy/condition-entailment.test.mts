import { describe, expect, it } from 'vitest'

import { conditionEntails } from './condition-entailment.mts'

describe('conditionEntails', () => {
  it('treats an empty condition as entailed by anything, since it always runs', () => {
    expect(conditionEntails('', "vars.X == 'true'")).toBe(true)
  })

  it('treats `success()` and `always()` guards as entailed by anything', () => {
    expect(conditionEntails('success()', "vars.X == 'true'")).toBe(true)
    expect(conditionEntails('always()', '')).toBe(true)
  })

  it('entails when the guard condition is identical to the consumer condition', () => {
    expect(
      conditionEntails(
        "steps.validate.outcome == 'success'",
        "steps.validate.outcome == 'success'",
      ),
    ).toBe(true)
  })

  it('entails when every guard clause is also one of the consumer clauses', () => {
    expect(conditionEntails("vars.X == 'true'", "vars.Y == 'true' && vars.X == 'true'")).toBe(true)
  })

  it('does not entail when a guard clause is absent from the consumer clauses', () => {
    expect(conditionEntails("vars.Y == 'true' && vars.X == 'true'", "vars.X == 'true'")).toBe(false)
  })

  it('entails when a parenthesized OR guard clause has a branch the consumer requires', () => {
    expect(
      conditionEntails(
        "(vars.A == 'true' || vars.B == 'true') && vars.G == 'true'",
        "vars.A == 'true' && vars.G == 'true'",
      ),
    ).toBe(true)
    expect(
      conditionEntails(
        "(vars.A == 'true' || vars.B == 'true') && vars.G == 'true'",
        "vars.B == 'true' && vars.G == 'true'",
      ),
    ).toBe(true)
  })

  it('does not entail when none of the OR branches match a consumer clause', () => {
    expect(
      conditionEntails(
        "(vars.A == 'true' || vars.B == 'true') && vars.G == 'true'",
        "vars.C == 'true' && vars.G == 'true'",
      ),
    ).toBe(false)
  })

  it('does not split on && or || that appear inside a quoted string', () => {
    expect(
      conditionEntails("vars.LABEL == 'a && b'", "vars.LABEL == 'a && b' && vars.G == 'true'"),
    ).toBe(true)
    expect(conditionEntails("vars.LABEL == 'a && b'", "vars.LABEL == 'a'")).toBe(false)
  })

  it('does not strip parens that merely start and end the string without matching each other', () => {
    // "(a) && (b)" starts with "(" and ends with ")" but they are not a matching pair — the guard
    // has two separate clauses "(a)" and "(b)", neither of which is an OR-group.
    expect(conditionEntails('(vars.A) && (vars.B)', 'vars.A')).toBe(false)
  })

  it('does not let a default/success() guard entail an always() or failure() consumer', () => {
    // A guard with an omitted `if:` (or explicit `success()`) is itself skipped once any prior
    // step in the job has failed — it cannot protect a consumer that keeps running on that path.
    expect(conditionEntails('', 'always()')).toBe(false)
    expect(conditionEntails('success()', 'always()')).toBe(false)
    expect(conditionEntails('', 'failure()')).toBe(false)
    expect(conditionEntails("vars.X == 'true'", "vars.X == 'true' && always()")).toBe(false)
  })

  it('lets an always() guard entail any consumer status, since it has no restriction', () => {
    expect(conditionEntails('always()', 'always()')).toBe(true)
    expect(conditionEntails('always()', 'failure()')).toBe(true)
    expect(conditionEntails("always() && vars.G == 'true'", "failure() && vars.G == 'true'")).toBe(
      true,
    )
  })

  it('rejects a failure()/cancelled() guard outright, since it cannot reason about failure paths', () => {
    expect(conditionEntails('failure()', 'always()')).toBe(false)
    expect(conditionEntails('cancelled()', '')).toBe(false)
  })

  it('rejects an unparenthesized &&/|| mix as a consumer, since && binds tighter than || and naive splitting would misread its grouping', () => {
    // "A || B && G" means "A || (B && G)" in GitHub Actions, not "(A || B) && G" — a guard gated
    // only on G must not be treated as entailed, since the consumer can still run via the A branch
    // while G is false.
    expect(
      conditionEntails(
        "vars.G == 'true'",
        "vars.A == 'true' || vars.B == 'true' && vars.G == 'true'",
      ),
    ).toBe(false)
  })

  it('rejects an unparenthesized &&/|| mix as a guard outright, even against an identical consumer', () => {
    const mixed = "vars.A == 'true' || vars.B == 'true' && vars.G == 'true'"
    expect(conditionEntails(mixed, mixed)).toBe(false)
  })

  it('does not flag a pure unparenthesized OR (no &&) as ambiguous', () => {
    const pureOr = "vars.A == 'true' || vars.B == 'true'"
    expect(conditionEntails(pureOr, pureOr)).toBe(true)
  })

  it('does not flag && and || inside a quoted string as a top-level mix', () => {
    expect(
      conditionEntails(
        "vars.LABEL == 'a || b' && vars.G == 'true'",
        "vars.LABEL == 'a || b' && vars.G == 'true'",
      ),
    ).toBe(true)
  })

  it('rejects a negated status function as a guard, since negation changes its permissiveness', () => {
    // `!cancelled()` runs on both success and failure — a strict superset of the default
    // success()-only restriction — so an empty (default) guard must not be treated as entailing
    // it, even though the bare `cancelled()` clause is recognized by STATUS_CLAUSES.
    expect(conditionEntails('', '!cancelled()')).toBe(false)
    expect(conditionEntails('success()', '!cancelled()')).toBe(false)
  })

  it('rejects a negated status function as a consumer for the same reason', () => {
    expect(conditionEntails('!cancelled()', '')).toBe(false)
  })

  it('still recognizes a parenthesized bare status function', () => {
    expect(conditionEntails('(success())', "vars.X == 'true'")).toBe(true)
    expect(conditionEntails('(always())', '(failure())')).toBe(true)
  })

  it('does not misclassify a negated non-status clause as a status function', () => {
    // `!vars.X == 'true'` has nothing to do with success()/failure()/cancelled() — it must fall
    // through to being treated as an ordinary clause, not a conservative `other` status.
    expect(conditionEntails("!vars.X == 'true'", "!vars.X == 'true'")).toBe(true)
  })

  it('rejects a consumer with a status function nested inside an OR branch', () => {
    // `always() || vars.FORCE == 'true'` can still run after an earlier failure via the always()
    // branch, even though the whole clause isn't a bare status-function match — a default-status
    // (omitted `if:`) guard must not be treated as entailing it, since that guard is itself
    // skipped on the exact failure path the always() branch keeps running on.
    expect(conditionEntails('', "always() || vars.FORCE == 'true'")).toBe(false)
    expect(
      conditionEntails("vars.G == 'true'", "vars.G == 'true' && (always() || vars.FORCE)"),
    ).toBe(false)
  })

  it('rejects a guard with a status function nested inside an OR branch, even against an identical consumer', () => {
    const mixed = "always() || vars.FORCE == 'true'"
    expect(conditionEntails(mixed, mixed)).toBe(false)
  })
})
