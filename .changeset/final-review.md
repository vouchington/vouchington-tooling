---
'vouchington-tooling': minor
---

Add the `final-review` skill to the `vouchington-workflow` plugin (now 0.16.0) and a
`vouchington final-review` CLI.

- `final-review` reviews a pull request with independent pillar reviewers (rules, correctness,
  design, blast radius, security, history, and congruence), verifies their findings on the
  strongest model, and posts one self-review. Effort is `low`, `medium`, or `high` (the default);
  follow-ups use `low` and review only the commits since the last reviewed SHA. A standing
  `final-reviewer` session can take review requests from other sessions.
- `final-review post` renders verified findings as COMMENT reviews with an
  `[Approve | Request Changes | Comment]` header, `[blocking]` and `[high|medium|low]` tags, inline
  comments where the diff allows, collapsible details, and numbered parts for large reviews. It
  adds or removes the `final approval` label and refuses when the head moved. `revoke` removes the
  label before a re-review, and `status` tells merging agents whether the newest final review
  approved the current head.
- `final-review bench` runs each pillar prompt against labeled reverted and clean pull requests
  from a git-free snapshot of the pre-merge head, and reports recall, severity agreement, and the
  false-alarm rate.
- `placeReviewComment` is now exported from the review-payload module.
