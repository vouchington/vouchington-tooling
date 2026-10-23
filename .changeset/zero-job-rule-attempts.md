---
'vouchington-tooling': patch
---

Count previous attempts that created zero jobs toward a transient-retry rule's attempt total when the rule matches the attempt's run-level evidence, so `maxAttempts` trips for runs cancelled before any job starts.
