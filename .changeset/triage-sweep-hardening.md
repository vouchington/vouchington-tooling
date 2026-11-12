---
'vouchington-tooling': minor
---

`triage-sweep` and `triage-loop` get flake dedupe, a per-sweep preflight, schedule keepalive, and an
incremental Phase F (`vouchington-workflow` 0.19.0).

- A CI or queue-ejection flake is first matched against open issues by the failing test's file
  basename and name. A match gets one comment (run id, job, PR or commit) and is routed by that
  issue number. A queue ejection outside the grant notifies the owning agent session when it is
  running, otherwise it is listed in the summary.
- Every sweep verifies `gh` auth, `pr-shepherd`, the event wait, dispatch targets, and the journal
  server. A phase whose dependency fails is skipped with the reason, and the first failure of a
  dependency notifies once through `escalations`.
- Each sweep lists the loop's recurring jobs and re-registers the fallback sweep job when it is
  missing or near expiry, recording it in the state file's `schedule`. A durable host scheduler is
  preferred.
- Phase F keeps `lateReview.<repo>.scannedThrough` and fully scans only newer merges, rescans older
  ones only on new review activity, and runs a periodic full rescan (`fullScanAt`).
