---
'vouchington-tooling': minor
---

Add the dev-only `vouchington-tooling/pr-description` subpath export for policy-driven pull-request description validation, Markdown section sanitization, closing-reference and closure-provenance verification, milestone-completion and removed-surface supersession auditing, and plan-completion assessment:

- `validatePrBody`, `validatePrBodyWithIssueReferences`, `validatePrDescriptionContent`, `formatGitHubBodyLengthError`, `DEFAULT_PROVENANCE_RULES`, `DEFAULT_REQUIRED_HEADINGS`, `DEFAULT_RELATED_ISSUES_HEADING`, `sanitizedLines`, `extractRelatedIssuesLines`, `extractRelatedIssuesReferenceText`, `findEscapeCommentClosingKeywordLeaks`
- `hasRelatedIssuesNoSourcePair`, `extractPartialBatchSourceRef`, `validatePartialBatchSourceRef`
- `ESCAPE_COMMENT_RE`, `parseGitHubIssueApiResponse`, `validateResolvedIssueReferences`, `createClosingIssueReferenceResolver`, `resolveClosingIssueReference`, `currentRepo`, `formatReferencedIssueSummary`, `formatRelatedIssueHints`, `parsePullRequestIdentity`, `parsePullRequestRefOids`, `createIssueClosureResolver`
- `DEFAULT_AUDIT_CLASSIFICATIONS`, `isValidAuditClassification`, `parseIssueAuditKeepOpenDecisions`, `formatIssueAuditMarkerHint`, `DEFAULT_MILESTONE_COMPLETION_REMAINDER`, `buildMilestoneListArgs`, `findMilestoneCompletionSiblings`, `groupClosedIssuesByMilestone`, `validateMilestoneSiblings`, `createMilestoneAuditor`, `assessPlanCompletion`
- `createDiffSummary`, `reduceDiffBlock`, `parseRemovedExports`, `parseRemovedSurfaces`, `createAppRouterPathParser`, `parseChangedPackageJsonPaths`, `DEFAULT_REMOVAL_STOPLIST`, `buildRemovalVocabulary`, `findRemovedScripts`, `createLocalPackageJsonReader`, `createGhPackageJsonReader`, `readPullRequestPatch`, `buildSupersessionSearchArgs`, `findSupersessionHits`, `parseAuditDecisions`, `validateAuditHits`, `createSupersessionAuditor`, `runAdvisorySupersessionSearch`
