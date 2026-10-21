---
'vouchington-tooling': patch
---

`stacked-prs` (vouchington-workflow 0.13.1) now prefers merging the whole stack in one command,
targeting the top layer. It drains the ready lower layers first only when the layers above will
clearly take longer: an open requested change or `TRIAGE`, a pending human review, a blocker, or
CI far longer than the wait so far. A layer a poll or a ready-delay away is not a reason. Before
merging, it re-reads every layer above the target and retargets to the top when they are all
ready, so a ready stack is never drained bottom-up. `triage-prs` follows the same rule.
