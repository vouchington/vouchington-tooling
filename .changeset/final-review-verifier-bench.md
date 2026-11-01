---
'vouchington-tooling': minor
---

`final-review bench-verifier` benchmarks the verifier alone on pillar findings saved by `final-review bench`: one model call per case and no subagents. It reports how many judged-real findings the verifier keeps, label recall before and after the verifier (crediting findings the verifier adds when a judge matches them to a label), severity agreement, the share of other blocking and high findings an independent read-only check confirms, how many planted cross-pillar duplicates it merges, and the finding count before and after. The verifier prompt now asks it to read cited ranges instead of whole files, so large pull requests fit in context.
