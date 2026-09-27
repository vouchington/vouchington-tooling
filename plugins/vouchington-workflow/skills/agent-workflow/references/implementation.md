# Implementation

For cross-cutting work, track accepted interface, data, validation, and ownership decisions that
could otherwise be lost during coding. Start from a failing behavioral test when practical and
complete the real path rather than adding placeholders or compatibility shims without a requirement.

When behavior changes, update the public contract, documentation, fixtures, and generated artifacts
that describe it. Keep local commands, branch policy, and release mechanics in the consumer wrapper.

Resolve rebase conflicts semantically: identify the upstream invariant, integrate both changes,
and rerun the tests for that invariant. Do not treat the conflict as a choice of whole-file versions.

Removing a deadline or abort bound needs a replacement on the same path, or evidence and a test
showing every caller supplies its own bound. When changing a policy table, check sibling rows for
contradictory conventions.
