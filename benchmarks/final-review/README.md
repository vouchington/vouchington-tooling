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
history. It writes the title, description, and a numbered diff (base and head line numbers on every
line) into `.final-review/` inside that tree, then
runs `claude -p` on Sonnet with only `Read`, `Grep`, and `Glob`. With no shell, network, or
`gh`, the reviewer cannot look up the revert. Each pillar prompt is prefixed with the shared
`_contract.md`.

Results are written to `<out>/raw/<pillar>/<case>.json`, then `summary.json` and `summary.md`. Use
`--score-only` to re-score existing raw results, and `--case <id>` to run one case. Runs cost
money and take minutes per case, so run only the pillars whose prompts changed.

Add `--judge sonnet` to grade by claim instead of location. A tool-less `claude -p` call per case
decides which finding, if any, raises each labeled problem, even at a different file or line, and
stores the assignment in the raw result. Judging is cached per model, so `--score-only --judge
sonnet` re-scores for free after the first pass. Prefer judged numbers; location matching both
credits unrelated findings at the right file and misses the right claim cited elsewhere.

## Verifier

The verifier is benchmarked on its own, without re-running pillars or dispatching subagents:

```bash
pnpm exec vouchington final-review bench-verifier \
  --cases benchmarks/final-review/cases.json \
  --findings-from "$TMPDIR/final-review-bench" \
  --prompts plugins/vouchington-workflow/skills/final-review/references \
  --out "$TMPDIR/final-review-verifier" --jobs 3
```

`--findings-from` is the `--out` directory of an earlier `bench` run. The command first judges any
of those pillar results that lack a current `--judge` assignment (default `sonnet`), so each input
finding is labeled real (it raises a labeled problem) or noise. For each case it gathers every
pillar's findings, plants a copy of each real finding under a second pillar, and makes one
`claude -p` call (default Opus) in the same git-free snapshot with `verifier.md`, the congruence
pillar, and the findings as indexed JSON. The verifier returns the review with `sources` on every
finding: the input indexes it confirms or merges.

The verifier may add findings of its own, with an empty `sources` array. A correct addition is a
win, so findings are graded on whether they are right rather than counted:

- **Real kept**: real inputs that some output finding cites, directly or through the planted copy.
- **Label recall, pillars → verifier**: labeled problems raised by the pillar findings, and by the
  verifier's output. The output credits a label through a kept real input, or through an added
  finding that the `--judge` model matches to it.
- **Severity agreement**: raised labels whose strongest output severity is within one level of the
  label.
- **Other blocking/high confirmed**: every `blocking` or `high` output finding not credited to a
  label goes to an independent check (`--checker`, default Opus, read-only tools in the same
  snapshot) that decides whether the claim is true at the head. Negative cases were only not
  reverted, so a confirmed finding there is a real catch, not a false alarm.
- **Duplicates merged**: planted pairs that end in exactly one output finding.
- **Findings before → after**: mean pillar findings per case (copies excluded) and mean output
  findings.

Results go to `<out>/raw/<case>.json` (input, output, and grade), `summary.json`, and
`summary.md`. A saved verifier output is reused only while the case head, verifier prompt, model,
turn limit, and input findings all match, so a rerun resumes, repeats what changed, and grades only
what is missing. `--score-only` re-scores the saved outputs as they are, without model calls.

## Metrics

| Metric             | Meaning                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ |
| Recall             | Expected findings matched by the judge, or by path and a line within 10 of the range |
| Severity agreement | Matched findings whose severity is within one level of the label                     |
| False alarms       | Negative cases with at least one `blocking` or `high` finding                        |
| Findings per PR    | Mean findings per case, to watch for noisy prompts                                   |

Without `--judge`, scoring is mechanical: a finding at the right place with a wrong claim still
counts. Either way, read the raw findings for any case whose result changes. A finding that covers
two labeled problems is credited once.
