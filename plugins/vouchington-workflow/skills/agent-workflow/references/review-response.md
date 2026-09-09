# Review response

Applies when responding to feedback on an open change — a human reviewer, an automated reviewer, or
a shepherding tool that surfaces both. This is the response side of [review](review.md); its closing
line, to record unresolved risk as an explicit decision or follow-up and never as an unnoticed gap,
is what the ladder below operationalizes.

Give every surfaced item exactly one disposition before its resolution runs, recorded where the
review conversation lives. Invalid — wrong, already satisfied by the current diff, or out of an
already-settled scope — gets a reason and closes with no code change and no follow-up. Blocking —
correctness, security, data safety, or a gap against a linked requirement — gets fixed, pushed, and
confirmed on the change's head commit before closing; closing first can leave an unfixed commit
behind a closed conversation. Non-blocking gets folded into an already-planned push when the fix is
cheap and low-risk, and otherwise gets recorded as a follow-up only when leaving it undone would
change behavior, structure, or risk: reuse or extend an existing follow-up before opening a new one,
and group related items from the same round into one. A correct item that clears none of those bars
— a style preference, a restatement, polish the change is fine without — is declined with a reason
and no follow-up; that is the expected outcome for a minor suggestion, not a lapse. Escalate — work
the change cannot absorb as feedback, such as a large architectural or ownership change — is
recorded where decisions are tracked and reported for direction rather than implemented or silently
downgraded to a follow-up.

Read every outstanding item before editing and drain the round locally; the cost of iterating is the
push, not the commit, because a push re-runs checks and re-triggers automated reviewers. Declining a
round without pushing is what lets it converge instead of regenerating the same suggestions on every
cycle. By hand-off, every item carries a disposition and reaches closure — an escalation through its
decision record rather than an open conversation — except where the review surface itself withholds
the capability to close an item; say so and leave it rather than forcing a resolution it never
authorized.

This skill supplies no review system, resolution mechanism, issue tracker, label, or severity
vocabulary; a consumer wrapper owns those.
