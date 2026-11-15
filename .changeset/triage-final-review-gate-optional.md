---
'vouchington-tooling': patch
---

The triage skills' final-review gate is now an optional adapter parameter that is off unless the adapter turns it on. With it off, `triage-loop`, `triage-sweep` and `triage-prs` skip every `vouchington-reviewer` step and never report `awaiting-final-review`. vouchington-workflow 0.20.1.
