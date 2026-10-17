---
'vouchington-tooling': minor
---

Add the `triage-prs` skill to the `vouchington-workflow` plugin (now 0.13.0). It reviews the PR
queue, merges or closes under the user's triage authorization, closes orphan automation issues, and
publishes preauthorized prompt feedback. Repository-specific values (the automation label,
orphan-issue rules, the ready-and-shepherd skill and its activation preflight, prompt-source paths,
the feedback marker, and merge and CI-failure policy) are adapter parameters that the consumer
supplies. Extracted from vouchington/vouchington at 0341b883d32565f05f43e8e693db5e05e8099ff2.
