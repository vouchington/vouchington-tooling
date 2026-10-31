---
'vouchington-tooling': minor
---

Default the `setup-node-pnpm` action's `install-attempts` input to 1 so a timed-out pnpm install fails once instead of being retried; callers may raise it to retry.
