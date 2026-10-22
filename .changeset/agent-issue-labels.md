---
'vouchington-tooling': minor
---

Add `vouchington-tooling/agent-issue-labels` and `vouchington agent-issue-labels`. `labels-from-paths`
maps changed paths to labels using an `actions/labeler` config (default `.github/labeler.yml`).
`ensure-labels` creates missing repository labels through `gh`, optionally for `--repo owner/name`
and with `--update` to rewrite metadata. Label colors, descriptions, the default metadata, and the
prefixes that require an explicit entry come from a `--policy-file` JSON file or a typed
`LabelPolicy` option rather than built-in values.
