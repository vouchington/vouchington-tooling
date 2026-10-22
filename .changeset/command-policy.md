---
'vouchington-tooling': minor
---

Add a `command-policy` subpath: `evaluateCommandPolicy` judges a tool call's shell command against a caller-supplied rule table (typo paths, protected paths, command and git patterns, GitHub stack workflow, merge authority). It also exports the GitHub command parsing it is built on (invocations, options, command position and cwd, checkout owners) and a `standardGitPatterns` preset. Every repository-specific path, reason, base branch, and pointer is a parameter.
