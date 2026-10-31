# Final review benchmarks

Labeled pull requests for benchmarking the `final-review` pillar prompts in
`plugins/vouchington-workflow/skills/final-review/references/pillars/`.

## Cases

`cases.json` is an array of cases:

- **Positive** cases are pull requests that were reverted or needed a regression fix. Each has one
  or more `expected` findings: the pillar that should have caught it, a severity, the file, the
  head-side line range (or `null`), and the claim a good reviewer would have made before the
  revert.
- **Negative** cases are merged pull requests that stayed unreverted, with no fix to the same lines
  within 30 days. They have no expected findings and measure false alarms.

Use a line range only when the defect lives on specific lines. Approach-level claims (most design,
congruence, and history findings) use `"lines": null`, so any finding on the file counts: a
reviewer may rightly raise the same concern far from where a labeler guessed.

This repository is public, so `cases.json` holds only cases from public repositories. Keep cases
from private repositories in a private location and pass that file with `--cases`.

Labels are written by people or agents from the revert and fix history. Add cases by mining new
reverts and regression fixes, and keep negatives at roughly a third of the set.

## Running

```bash
pnpm exec vouchington final-review bench \
  --cases benchmarks/final-review/cases.json \
  --prompts plugins/vouchington-workflow/skills/final-review/references/pillars \
  --out "$TMPDIR/final-review-bench" \
  --pillar design --jobs 3
```

For each case, the runner exports the pull request head with `git archive`, so the tree has no
history. It writes the title, description, and diff into `.final-review/` inside that tree, then
runs `claude -p` on Sonnet with only `Read`, `Grep`, and `Glob`. With no shell, network, or
`gh`, the reviewer cannot look up the revert. Each pillar prompt is prefixed with the shared
`_contract.md`.

Results are written to `<out>/raw/<pillar>/<case>.json`, then `summary.json` and `summary.md`. Use
`--score-only` to re-score existing raw results, and `--case <id>` to run one case. Runs cost
money and take minutes per case, so run only the pillars whose prompts changed.

## Metrics

| Metric             | Meaning                                                                         |
| ------------------ | ------------------------------------------------------------------------------- |
| Recall             | Expected findings matched by path and by a line within 10 of the expected range |
| Severity agreement | Matched findings whose severity is within one level of the label                |
| False alarms       | Negative cases with at least one `blocking` or `high` finding                   |
| Findings per PR    | Mean findings per case, to watch for noisy prompts                              |

The scoring is deliberately mechanical. A finding at the right place with a wrong claim still
counts, so read the raw findings for any case whose result changes.
