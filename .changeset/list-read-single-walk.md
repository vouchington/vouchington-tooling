---
'vouchington-tooling': patch
---

Teach single-walk list and feed reads in `vouchington-database` (0.10.0): one index-served keyset walk bounded by the page `LIMIT` plus a time window or keyset, no `MATERIALIZED` or capped candidate pools, never a short page while `has_next_page` is true, and measurement against the plain single walk.
