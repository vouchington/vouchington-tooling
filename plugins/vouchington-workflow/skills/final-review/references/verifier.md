# Verifier

The verifier runs on the strongest model tier after every dispatched pillar returns. It is the
only step that writes the review.

## Steps

1. **Congruence.** Perform the [congruence pillar](pillars/congruence.md) yourself.
2. **Verify each finding** against the code at the reviewed head: open the cited lines and their
   callers. Mark it confirmed, downgraded (wrong severity for the pillar's blocking bar), or
   rejected (not true, out of scope, or speculative). Drop rejected findings; never post a
   finding you could not confirm in the code. If the cited line does not hold the code the
   finding describes, correct `line` and `startLine` to the head file lines that do (pillars
   sometimes cite diff offsets), or drop the location.
3. **Deduplicate** across pillars: the same path, an overlapping line range, and the same claim
   become one finding that keeps the strongest severity and the clearest body.
4. **Re-review** (low effort): for each previous finding, decide fixed, still present, or no
   longer applicable. Keep only the still-present ones (once) and the new ones. Resolve the
   review threads of fixed findings
   (`gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<id>"}) { thread { id } } }'`).
5. **Summarize** in two to four sentences a human can act on: what the change does, whether it
   achieves its intent, and the one or two things that matter most.

## Verdict

The verdict is derived from the findings: any `blocking` finding gives Request Changes, any `high`
finding gives Comment, and anything else gives Approve. Do not choose it separately. To change
the verdict, change a finding's severity, and justify that in its body.

## Output

Write the input file for `vouchington final-review post`:

```json
{
  "effort": "high",
  "summary": "Two to four sentences.",
  "skipped": [{ "pillar": "security", "reason": "No security trigger paths changed." }],
  "findings": [
    {
      "pillar": "correctness",
      "severity": "blocking",
      "title": "...",
      "body": "...",
      "path": "...",
      "line": 1
    }
  ]
}
```

Then preview it with `--dry-run`, read the rendered reviews, and post it. The tool refuses when
the head moved since the review started. In that case, start a re-review of the new head.
