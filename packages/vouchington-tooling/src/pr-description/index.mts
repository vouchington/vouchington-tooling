export {
  ESCAPE_COMMENT_RE,
  parseGitHubIssueApiResponse,
  validateResolvedIssueReferences,
} from './closing-refs.mts'
export type { IssueReferenceValidationResult } from './closing-refs.mts'

export {
  DEFAULT_RELATED_ISSUES_HEADING,
  DEFAULT_REQUIRED_HEADINGS,
  extractRelatedIssuesLines,
  extractRelatedIssuesReferenceText,
  validatePrDescriptionContent,
} from './content-policy.mts'
export type { PrDescriptionContentPolicy } from './content-policy.mts'

export { createDiffSummary, reduceDiffBlock } from './diff-summary.mts'
export { findEscapeCommentClosingKeywordLeaks } from './escape-comment-leaks.mts'

export {
  DEFAULT_AUDIT_CLASSIFICATIONS,
  formatIssueAuditMarkerHint,
  isValidAuditClassification,
  parseIssueAuditKeepOpenDecisions,
} from './issue-audit-marker.mts'
export type { AuditClassification, IssueAuditKeepOpenDecision } from './issue-audit-marker.mts'

export {
  createIssueClosureResolver,
  parsePullRequestIdentity,
  parsePullRequestRefOids,
} from './issue-closure.mts'

export {
  createMilestoneAuditor,
  groupClosedIssuesByMilestone,
  validateMilestoneSiblings,
} from './milestone-audit.mts'
export type { MilestoneAuditOptions } from './milestone-audit.mts'

export {
  buildMilestoneListArgs,
  DEFAULT_MILESTONE_COMPLETION_REMAINDER,
  findMilestoneCompletionSiblings,
} from './milestone-query.mts'
export type { MilestoneGroup, MilestoneSibling } from './milestone-query.mts'

export {
  extractPartialBatchSourceRef,
  hasRelatedIssuesNoSourcePair,
  validatePartialBatchSourceRef,
} from './no-source.mts'
export type { NoSourceLinePairTemplate, PartialBatchTemplate } from './no-source.mts'

export { createGhPackageJsonReader, createLocalPackageJsonReader } from './package-json-source.mts'
export { assessPlanCompletion } from './plan-completion.mts'
export type { PlanCompletionAssessment, PlanCompletionPullRequest } from './plan-completion.mts'

export type {
  ClosingIssueForAudit,
  ClosureLookup,
  DiffSummary,
  IssueClosureResolver,
  IssueReferenceLookup,
  IssueReferenceResolver,
  PackageJsonReader,
  PullRequestIdentity,
  PullRequestReference,
  PullRequestRefOids,
  ReferencedIssue,
  RemovedSurface,
  RoutePathParser,
} from './pr-description-types.mts'

export { readPullRequestPatch } from './pull-request-patch.mts'
export type { ProcessPullRequestDiff, PullRequestPatch } from './pull-request-patch.mts'

export {
  createClosingIssueReferenceResolver,
  currentRepo,
  formatReferencedIssueSummary,
  formatRelatedIssueHints,
  resolveClosingIssueReference,
} from './related-issues.mts'
export type { RelatedIssueCandidate } from './related-issues.mts'

export { parseRemovedExports } from './removed-exports.mts'
export { findRemovedScripts } from './removed-scripts.mts'

export {
  buildRemovalVocabulary,
  createAppRouterPathParser,
  DEFAULT_REMOVAL_STOPLIST,
  parseChangedPackageJsonPaths,
  parseRemovedSurfaces,
} from './removed-surfaces.mts'
export type { ParseRemovedSurfacesOptions } from './removed-surfaces.mts'

export { sanitizedLines } from './sanitized-lines.mts'

export {
  buildSupersessionSearchArgs,
  createSupersessionAuditor,
  findSupersessionHits,
  parseAuditDecisions,
  runAdvisorySupersessionSearch,
  validateAuditHits,
} from './supersession.mts'
export type {
  SupersessionAuditOptions,
  SupersessionDecision,
  SupersessionHit,
  SupersessionVocabularyOptions,
} from './supersession.mts'

export {
  DEFAULT_PROVENANCE_RULES,
  formatGitHubBodyLengthError,
  validatePrBody,
} from './validate-body.mts'
export type {
  NoSourcePolicyRule,
  PrBodyValidationOptions,
  PrBodyValidationPolicy,
  PrBodyValidationResult,
  ProvenanceLineRule,
} from './validate-body.mts'

export { validatePrBodyWithIssueReferences } from './validate.mts'
export type { IssueReferenceValidationOptions } from './validate.mts'
