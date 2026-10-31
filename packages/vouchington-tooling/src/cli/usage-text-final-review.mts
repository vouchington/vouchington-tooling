export const FINAL_REVIEW_COMMAND = `  final-review                  Post, revoke, check, or benchmark multi-pillar final reviews
`

export const FINAL_REVIEW_USAGE = `final-review post --repo owner/name --pr N --head-sha SHA --input findings.json [--dry-run]
final-review revoke --repo owner/name --pr N
final-review status --repo owner/name --pr N
final-review bench --cases cases.json --prompts DIR --out DIR [--pillar NAME]... [--case ID]... [--model NAME] [--jobs N] [--max-turns N] [--score-only]
  post renders verified findings as one or more COMMENT reviews (verdict, reviewed SHA and effort in
  the header; inline comments where the diff allows, the rest in the body) and adds the "final
  approval" label on Approve or removes it otherwise. It refuses when the head moved. revoke removes
  the label before a re-review. status exits 0 only when the newest final review approved the current
  head and the label is present. bench runs each pillar prompt against labeled cases from a git-free
  snapshot of the pre-merge head and scores recall and precision.

`
