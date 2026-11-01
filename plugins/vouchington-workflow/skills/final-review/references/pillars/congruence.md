# Pillar: congruence

The [verifier](../verifier.md) performs this pillar itself. Follow
[the pillar contract](_contract.md).

## Scope

Does the code match what the pull request says?

- The title and description: every stated behavior exists, nothing significant is unstated
  (behavior changes, breaking changes, migrations, new dependencies), and the testing claims are
  true.
- Referenced and closing issues (`Fixes #N`): the change actually resolves each one, or the
  reference should not close it.
- Commit and release metadata where the repository uses it (conventional commit type and scope,
  breaking-change markers).

## Not in scope

Whether the behavior is correct or well designed. Only whether it is described truthfully.

## Blocking bar

The description states behavior the code does not have, omits a breaking change, or closes an
issue the change does not resolve. Vague or incomplete descriptions are `medium` or `low`.
