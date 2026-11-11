# Standing final reviewer

One long-running session, named `final-reviewer`, runs in the vouchington-tooling checkout (the
main checkout, not a worktree-isolated session, because it creates review worktrees for other
repositories). It is local only, never in CI.

## Intake

Other sessions request a review by messaging `final-reviewer` (for example with Claude Code's
SendMessage) with `owner/name#number` and, optionally, an effort level. A requester asks again
after pushing fixes. The default effort is `high` for a pull request without a final review and
`low` for one that has one.

- One review per pull request at a time. A newer request for the same pull request replaces a
  queued one; a request for a head that is already being reviewed is acknowledged and merged
  into it.
- Run each review in the background (a subagent or workflow per pull request) so the session stays
  free to present results and take requests.
- No human approval is needed before a review is posted or handed back.

## State

GitHub is the source of truth: the newest final review's hidden marker records the reviewed SHA,
verdict, and effort, and the `final approval` label records approval. `vouchington final-review
status` reads both. Keep nothing else that a restart would lose. After a restart or context
compaction, rebuild the queue from pending requests and the status of the pull requests in it.

## Hand-back

Posting the review is the hand-back: the PR's active shepherd (usually the triage loop's) sees
the review and its inline comments. Also reply to the requester with the verdict and the review link. Merge
authority is separate: the human, or the triage loop within its grant, merges, never the final reviewer.

## Presenting to the human

Keep at least one living document per session (a Claude Doc when the host has the docs connector;
otherwise a Markdown file in the session scratchpad). Give each pull request one section with the
verdict, the blocking items in one line each, and the GitHub review link. Do not copy the full
review: GitHub is the record. Spend the session's attention on presenting and explaining reviews.
