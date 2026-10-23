---
'vouchington-tooling': patch
---

`vouchington hook post-tool-use` stays silent for Grok, which ignores passive-event stdout, and the
git rules in `pre-tool-use` now also inspect `$(...)` and backtick substitutions inside double
quotes (`echo "$(git push --force)"`), best effort and one level deep.
