# Sandbox and permission audit

The `## Sandbox & Permission Audit` section reports commands that were denied, escalated, or failed
under a sandbox. It is built from journal entries alone:

- `sandbox-escalation`, `sandbox-failure`, and `ambiguous-failure` blocks in the journal (see the
  [blackboard](../../blackboard/SKILL.md#sandbox-and-permission-blocks) skill) are the source for
  every escalation, denial, and failure on every harness.
- The `escalations` in `retrospective-transcript` facts are supplementary evidence, reported
  separately under the transcript facts. They list tool calls whose arguments requested elevated
  permissions, with a normalized command prefix, justification, and prefix rule, but only for
  harnesses whose rollout records a sandbox-permission request on the tool call. Use them to check
  that each reported request has a journal block; they do not replace one. The approval outcome is
  not recorded in a stable shape, so never report one from these.

## Reading the evidence

- Escalation frequency alone is not a policy gap. Attribute an escalation to a mechanism, such as
  an argument-size limit from an oversized sandbox profile, only from the current normalized
  diagnostic. Keep argument-limit failures, linked-worktree write denials, credential or network
  boundaries, and deliberate policy refusals separate.
- A request is not approval or denial, and a localhost refusal is not proof of sandbox enforcement.
  Report an outcome only when evidence shows it.
- A linked-worktree write denial needs the sandbox's write coverage to change; an allowlist entry
  does not fix it.
- A denial from a rule working as intended, such as a blocked force push, is a hygiene count, not a
  candidate for anything.

## Decision criteria

Before treating an uncovered command as a gap, confirm it is invokable at `HEAD`: the binary, script,
or package entry it names still exists. A transcript can be stale.

- Genuine bypass, judged read-only and safe: a generic tool family belongs in machine-level policy,
  not this repository. A checked-in script that must leave the sandbox gets the narrowest exact
  entry the consumer's policy allows. Never allowlist a broad prefix such as a bare `git`.
- Genuine bypass needing network access whose safety is unclear: do not allowlist it because it
  appeared once. Escalation is the correct behavior for a command that always needs a judgment call.
  Flag it for a human.
- Human-rejected command: propose a block rule, but surface it for human review and never write a
  deny rule from a retrospective. One rejection is one data point; confirm the pattern recurs.

## Privacy

Report a normalized `<command> <subcommand>` prefix and counts, never the raw command line or a
justification verbatim. For a short command the prefix is the whole command, so a branch slug, short
path, or hostname can appear in it: skim and redact before saving. Retrospectives are distilled into
public issues.
