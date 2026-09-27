# Review

Review the complete diff, not only changed implementation lines. Check premise and scope, public
contract compatibility, failure paths, authorization, untrusted input, secrets, and security
boundaries. Remove dead paths and stale documentation rather than labeling them as legacy.

Record unresolved risk as an explicit accepted decision or follow-up, never as an unnoticed gap.
Check the pull-request description against the final behavior and audience impact. After CI
diagnosis, ensure confirmed local-verification gaps or local/CI mismatches and their correction
remain disclosed; passing checks do not erase the gap discovered earlier.
