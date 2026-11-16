---
'vouchington-tooling': minor
---

vouchington-workflow 0.24.0: the `triage-loop`, `triage-sweep`, and `triage-prs` skills read local
settings from one JSON file, `.triage-loop.json` in the launch directory (or `TRIAGE_LOOP_CONFIG`),
documented in `triage-loop/references/config.md`, instead of a consumer adapter skill. The
`triage-loop` skill now ships `scripts/state.py` (the only writer of `state.json`) and
`scripts/wait.py` (one `hook-harness wait` over the configured repositories), and `triage-sweep`
ships the in-page Dependabot update-check script in `references/dependency-update-check.md`.
