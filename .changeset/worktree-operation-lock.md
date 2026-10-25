---
'vouchington-tooling': minor
---

Add `scripts/worktree/operation-lock.sh`, a sourceable symlink+PID operation lock with a caller-supplied root (`worktree_operation_lock_acquire`, `_release`, `_clear_stale`). It covers critical sections that share shell state with the surrounding script, which `with-host-lock` cannot wrap.
