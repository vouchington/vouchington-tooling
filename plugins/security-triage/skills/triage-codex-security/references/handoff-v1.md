# `codex-security-triage/v1` handoff

The producer returns one record per source finding. `selectedRemote`, `canonicalRepository`,
`defaultBranch`, and `evidenceSha` are the repository binding.

```json
{
  "contract": "codex-security-triage/v1",
  "selectedRemote": "origin",
  "canonicalRepository": "github.example/owner/repository",
  "defaultBranch": "main",
  "evidenceSha": "immutable-default-branch-sha",
  "finding": {
    "id": "provider-finding-id",
    "url": "https://provider.example/findings/provider-finding-id",
    "title": "Synthetic example finding"
  },
  "verdict": "confirmed | needs_review | not_actionable | overstated",
  "disposition": "grouped_issue | provider_fix_pr | close | lower_severity",
  "issueCandidate": {
    "groupKey": "stable-group-key",
    "title": "Synthetic issue title",
    "summary": "Neutral summary for a consumer-owned issue workflow."
  },
  "evidence": {
    "paths": ["relative/path"],
    "rationale": "Evidence-backed assessment."
  },
  "execution": {
    "status": "proposed | completed | blocked",
    "closeReason": "already_fixed | false_positive | wont_fix",
    "severity": {
      "observed": "provider severity before action",
      "proposed": "requested severity",
      "resulting": "provider severity after action"
    },
    "receipt": "provider action receipt when completed"
  },
  "providerPullRequest": {
    "number": 123,
    "url": "https://provider.example/owner/repository/pull/123",
    "provenance": "provider-created fix"
  }
}
```

`issueCandidate` is optional and applies only to `grouped_issue`; its `groupKey`, `title`, and
`summary` are stable consumer inputs. Omit `closeReason`, `providerPullRequest`, and nonapplicable
`severity` members. `grouped_issue` is only a candidate: this contract never authorizes issue
creation or repository taxonomy changes.

Consumers must recompute their binding from the checkout and must reject a record unless its
`canonicalRepository`, `defaultBranch`, and `evidenceSha` exactly match. A remote name can differ
between checkouts, but the consumer's selected remote must normalize to the same canonical
repository; otherwise it must reject the record. The hosted selector has already been required to
prove that same canonical identity before a provider write.
