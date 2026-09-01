/* eslint-disable max-lines -- package entry point enumerates the supported public API. */

export { linkSkill, readSkillManifest } from './skill-discovery/index.mts'
export type {
  LinkSkillOptions,
  LinkSkillResult,
  SkillManifest,
  SkillManifestEntry,
} from './skill-discovery/index.mts'

export {
  codexChildren,
  codexIdentity,
  computeTranscriptFacts,
  formatTranscriptFacts,
  formatUnavailable,
  resolveTranscriptFile,
  runRetrospectiveTranscript,
} from './retrospective-transcript/index.mts'
export type {
  ResolveOptions,
  TokenTotals,
  TranscriptFacts,
} from './retrospective-transcript/index.mts'

export { runRetrospectiveFacts } from './retrospective-facts/index.mts'
export type {
  CommandExecutor,
  CommandResult,
  RetrospectiveFactsOptions,
} from './retrospective-facts/index.mts'

export {
  appendJournal,
  assertSessionId,
  cleanupSnapshotPartitions,
  partitionSnapshot,
  probeBlackboard,
  readJournal,
  resolveBlackboardConnection,
} from './agent-blackboard/index.mts'
export type {
  BlackboardConnection,
  SnapshotChecksum,
  SnapshotCleanupReceipt,
  SnapshotCleanupOptions,
  SnapshotCounts,
  SnapshotManifest,
  SnapshotPartition,
  SnapshotPartitionOptions,
  SnapshotPartitionResult,
  SnapshotSelection,
} from './agent-blackboard/index.mts'

export {
  buildSessionFrictionReport,
  classifyFrictionObservation,
  FRICTION_LOG_MAX_EVENTS,
  isConformingCiFailureBlock,
  normalizeCommandPrefix,
  readFrictionLog,
  recordFriction,
} from './session-friction/index.mts'
export type {
  FrictionEvent,
  FrictionEventKind,
  FrictionLogOptions,
  FrictionLogReadResult,
  FrictionObservation,
  JournalEntry,
  JournalLoader,
  JournalLoadResult,
  PermissionRequestObservation,
  SessionFrictionReport,
  SessionFrictionReportOptions,
  ToolResultObservation,
} from './session-friction/index.mts'

export {
  EphemeralListenerAttemptsExhaustedError,
  isRunnerReservedPort,
  listenOnRunnerUnreservedEphemeralPort,
  loadRunnerPortPolicy,
  runnerPortPolicy,
  validateRunnerPortPolicy,
} from './runner-port-policy/index.mts'
export type { EphemeralListenerOptions, RunnerPortPolicy } from './runner-port-policy/index.mts'

export {
  extractAlterTableAddColumnLocations,
  extractCreateIndexMetadata,
  extractCreateTableMetadata,
  extractDefaultFunction,
  extractDropIndexMetadata,
  extractFuncCallArgColumnNames,
  extractMigrationConstraintMetadata,
  initSqlAst,
  lineOfUtf8ByteOffset,
  MissingSqlAstParserError,
  parseSql,
} from './sql-ast/index.mts'
export type {
  ForeignKey,
  SqlCreateIndexMetadata,
  SqlCreateTableColumn,
  SqlCreateTableMetadata,
  SqlDropIndexMetadata,
  SqlIndexParam,
  SqlMigrationConstraintMetadata,
} from './sql-ast/index.mts'
export {
  dollarQuoteEnd,
  lineOf,
  maskSqlQuotedText,
  readDollarQuoteDelimiter,
  readStringLiteral,
  splitSqlStatements,
  sqlFragments,
  stripSqlComments,
} from './sql-scanner/index.mts'
export { auditCiJobRuntime, parseWorkflowNameMatch } from './gha-runtime-audit/index.mts'
export type {
  GhApiExecutor,
  RuntimeAuditOptions,
  RuntimeAuditResult,
  RuntimeAuditWorkflowFilter,
  RuntimeJobResult,
  RuntimeSample,
} from './gha-runtime-audit/index.mts'
export { checkGhaWorkspacePolicy } from './gha-workspace-policy/index.mts'
export type { GhaWorkspacePolicyOptions } from './gha-workspace-policy/index.mts'
export { requireUpToDate } from './require-up-to-date/index.mts'
export type { GitExecutor, RequireUpToDateOptions } from './require-up-to-date/index.mts'
export {
  gitleaksDirectoryScanArguments,
  runGitleaksDirectoryScan,
} from './gitleaks-directory-scan/index.mts'
export type {
  DirectoryScanExecutor,
  GitleaksDirectoryScanOptions,
} from './gitleaks-directory-scan/index.mts'
export { astGrepExamplesArguments, runAstGrepExamples } from './ast-grep-examples/index.mts'
export type { AstGrepExamplesExecutor, AstGrepExamplesOptions } from './ast-grep-examples/index.mts'
export {
  createVitestBlobManifest,
  createVitestReportAttempt,
  inspectVitestBlobBundle,
  parseVitestBlobManifest,
  parseVitestReportAttempt,
  readVitestReportAttempts,
  serializeVitestBlobManifest,
  serializeVitestReportAttempt,
  VITEST_BLOB_MANIFEST_FILENAME,
  VITEST_BLOB_MANIFEST_VERSION,
  VITEST_REPORT_ATTEMPT_PREFIX,
  VITEST_REPORT_ATTEMPT_VERSION,
  vitestBlobBundlePaths,
  writeVitestBlobManifest,
  writeVitestReportAttempt,
} from './vitest-blob-manifest/index.mts'
export type {
  InspectedVitestBlobBundle,
  VitestBlobIdentity,
  VitestBlobManifest,
  VitestReportAttempt,
  VitestReportAttemptIdentity,
} from './vitest-blob-manifest/index.mts'
export { prepareVitestReports } from './vitest-blob-manifest/reports.mts'
export type {
  PrepareVitestReportsOptions,
  RejectedVitestReportSource,
  SelectedVitestReport,
  VitestReportExpectation,
  VitestReportRejectionReason,
} from './vitest-blob-manifest/reports.mts'
export {
  findWorkspaceLinkMismatches,
  formatReleaseAgeFailure,
  INSTALL_TERMINATION_FAILED,
  isReleaseAgeViolation,
  parseInstallOptions,
  parseReleaseAgeViolations,
  runInstallLifecycle,
} from './pnpm-install/index.mts'
export type { InstallOptions, Lifecycle } from './pnpm-install/index.mts'
export {
  flattenReleaseAgeSelectors,
  packageNameFromPnpmLockKey,
  pnpmLockPackageKeyMatchesSelector,
  validateReleaseAgeExemptionGroups,
  validateReleaseAgePolicy,
} from './pnpm-install/index.mts'
export type {
  ReleaseAgeExemptionGroup,
  ReleaseAgePermanentExemption,
  ReleaseAgePolicyConfig,
  ReleaseAgePolicySnapshot,
} from './pnpm-install/index.mts'
export {
  buildContextFromTrackedFiles,
  buildSharedContext,
  clearFakeGitEnv,
  gitEnv,
  installFakeGit,
  runNamedChecks,
  setFakeGitTrackedFiles,
} from './shared-context/index.mts'
export type { FakeGitOptions, NamedCheck, SharedContext } from './shared-context/index.mts'
export {
  decodeSelectedFiles,
  encodeSelectedFiles,
  formatMultilineOutput,
  SELECTED_FILES_ENV_MAX_BYTES,
  selectedFilesExceedEnvBudget,
  writeSelectedFilesOutput,
} from './gha-selected-files/index.mts'
export {
  createArtifactClassifier,
  parseArtifactPatternsJson,
  planRunDeletions,
  runCleanup,
  sweepCleanup,
} from './gha-artifacts-cleanup/index.mts'
export type {
  ArtifactClassification,
  ArtifactClassifier,
  ArtifactPatterns,
  CleanupRequest,
  DeletionSummary,
} from './gha-artifacts-cleanup/index.mts'
export { validateOptionalHttpOrigin } from './http-origin/index.mts'
export {
  boundPendingLine,
  DEFAULT_MAX_PENDING_LINE_LENGTH,
  DEFAULT_TRUNCATED_LINE_MARKER,
  splitCompleteLines,
} from './process-line-buffer/index.mts'
export {
  isProcessGroupAlive,
  ProcessGroupDrainTimeoutError,
  runBrowserSession,
  waitForProcessGroupExit,
} from './browser-session-runner/index.mts'
export type {
  BrowserSessionDeps,
  BrowserSessionEvent,
  BrowserSessionExit,
  BrowserSessionOptions,
  BrowserSessionOutput,
  BrowserSessionProcess,
  BrowserSessionResult,
  BrowserSessionTerminationReason,
  BrowserSessionWatchdog,
  BrowserSessionWatchdogCleanup,
  BrowserSessionWatchdogController,
} from './browser-session-runner/index.mts'
export {
  buildSchemaSnapshot,
  detectRenamedIndexes,
  generateSchemaSnapshot,
  indexShapeKey,
  readSchemaCatalog,
  renderSchemaMarkdown,
  stableStringify,
  writeSchemaSnapshot,
} from './pg-schema-snapshot/index.mts'
export type {
  CatalogQuery,
  PartitionPolicy,
  SchemaCatalog,
  SchemaGrowthMaps,
  SchemaSnapshot,
  SchemaTableSnapshot,
} from './pg-schema-snapshot/index.mts'
export {
  buildOpenApiDocument,
  hashContractSchema,
  nodeToOpenApi,
  writeOpenApi,
} from './openapi-document/index.mts'
export type {
  BuildOpenApiDocumentInput,
  ContractSchema,
  OpenApiDocument,
  RequestContract,
  ResponseContract,
} from './openapi-document/index.mts'
export { decide, deriveRetryAttempt } from './transient-retry/index.mts'
export type {
  DecisionResult,
  EvaluateRulesOptions,
  NoMatchReason,
  RetryContext,
  RetryDecision,
  RetryRule,
  RetryTarget,
} from './transient-retry/index.mts'
export { escapeSpreadsheetFormula, parseCsvRows, streamCsvRows, stripCsvBom } from './csv/index.mts'
export {
  MissingResponseBodyError,
  readResponseBody,
  readResponseBodyAsBuffer,
  ResponseBodyTooLargeError,
} from './http-body/index.mts'
export type { ReadResponseBodyOptions } from './http-body/index.mts'
export { parseAstGrepRuleArgs, runAstGrepRule } from './ast-grep-rule/index.mts'
export type { AstGrepRuleInvocation, RunAstGrepRuleOptions } from './ast-grep-rule/index.mts'
export {
  indexReviewFiles,
  MAX_REVIEW_COMMENTS,
  MAX_REVIEW_PAYLOAD_BYTES,
  nearestReviewLine,
  parsePatchCommentable,
  parseReviewFilesJson,
  parseReviewPayload,
  readRegularReviewPayload,
  remapReviewComments,
  ReviewPayloadError,
  reviewCommentSubject,
  rewriteSnappedSuggestion,
  snapReviewNote,
  stageReviewPayload,
  writeStagedOutput,
} from './gha-review-payload/index.mts'
export type {
  CommentableIndex,
  CommentableLine,
  LineKind,
  PayloadRequirement,
  ReviewComment,
  ReviewFile,
  ReviewSide,
  SanitizedReview,
} from './gha-review-payload/index.mts'
export {
  PostReviewError,
  requireEnv,
  runPostReview,
  runPostReviewCli,
  postReviewWithTokenFromEnv,
} from './gha-post-review/index.mts'
export type { PostResult, PostReviewIo, PullFile } from './gha-post-review/index.mts'
/** @deprecated Import Claude helpers from vouchington-tooling/gha-claude-post-review. */
export {
  CLAUDE_OIDC_AUDIENCE,
  createActionsClaudeTokenIo,
  mintClaudeAppToken,
  resolveReviewPostToken,
  revokeClaudeAppToken,
  withClaudeAppToken,
} from './gha-post-review/index.mts'
/** @deprecated Import Claude helpers from vouchington-tooling/gha-claude-post-review. */
export type { ClaudeTokenIo, ReviewPostToken } from './gha-post-review/index.mts'
export {
  nextPageCursorFromLinkHeader,
  nextPageUrlFromLinkHeader,
  validatePaginationRequestUrl,
} from './http-link-pagination/index.mts'
export {
  cmdDownloadCoverage,
  cmdDownloadVitestBlobs,
  cmdUpload,
  mintPresignedControl,
  transportObjectKeys,
} from './coverage-transport/index.mts'
export type {
  ExpectedTransportIdentity,
  ObjectSigner,
  PresignIdentity,
  TransportControl,
} from './coverage-transport/index.mts'
export {
  EPOCH_PRUNED_AT,
  normalizeDeployedLayer,
  pruneDeployedRuntimeDeps,
  restoreDeployedWorkspacePackages,
} from './pnpm-deploy/index.mts'
export type {
  NormalizeDeployedLayerResult,
  PruneResult,
  RestoreWorkspacePackagesOptions,
} from './pnpm-deploy/index.mts'
export {
  parseDockerfilePrewarmStages,
  parseDockerfileRuntimeImages,
} from './dockerfile-parse/index.mts'
export type {
  DockerfilePrewarmStage,
  DockerfileRuntimeImage,
  ParseDockerfilePrewarmOptions,
  ParseDockerfileRuntimeImagesOptions,
} from './dockerfile-parse/index.mts'
export {
  buildSccArgs,
  checkSccComplexity,
  parseSccComplexityViolations,
  SCC_COMPLEXITY_LIMIT,
} from './scc-complexity/index.mts'
export type { SccComplexityOptions, SccComplexityViolation } from './scc-complexity/index.mts'
export { assertWorkflowCommandDrift, parseCiLocalArgs, runCiLocal } from './ci-local/index.mts'
export type {
  CiLocalCommand,
  CiLocalSpawn,
  CiLocalSpawnOptions,
  CiLocalSpawnResult,
  CiLocalTarget,
  RunCiLocalOptions,
} from './ci-local/index.mts'
export {
  GitHubRateLimitError,
  isRateLimited,
  isRetryableCancellationError,
  MAX_RATE_LIMIT_WAIT_MS,
  rateLimitDelay,
  reserveRateLimitDelay,
} from './gha-rate-limit/index.mts'
export {
  CHECKPOINT_MARKER,
  isTrustedCheckpointComment,
  parseCheckpoint,
  renderCheckpoint,
  sortedCheckpointCandidates,
  validateCheckpoint,
} from './gha-pr-checkpoint/index.mts'
export type {
  Checkpoint,
  CheckpointCodecOptions,
  GitHubComment,
} from './gha-pr-checkpoint/index.mts'
export { checkWorkspaceGatesPolicy } from './workspace-gates/index.mts'
export type { WorkspaceGatesOptions } from './workspace-gates/index.mts'
export { validateNugetUpdate } from './nuget-central-version/index.mts'
export { normalizeSwiftSource } from './swift-semantic-equal/index.mts'
export {
  isSwiftCodeOffset,
  parseUniqueSwiftBinaryTargetChecksum,
} from './swift-source-offset/index.mts'
export { validateResolvedPinDelta } from './swift-resolved-pin-delta/index.mts'
export type {
  ResolvedDocument,
  ResolvedPin,
  ValidateResolvedPinDeltaOptions,
} from './swift-resolved-pin-delta/index.mts'
export {
  DEFAULT_MAX_DIAGNOSTIC_REPORTS,
  DEFAULT_MAX_FORMATTED_DIAGNOSTIC_REPORTS,
  formatDiagnosticReportSummaries,
  HARD_MAX_DIAGNOSTIC_REPORTS,
  readDiagnosticReportSummaries,
  summarizeDiagnosticReport,
} from './vitest-diagnostics/index.mts'
export type {
  DiagnosticReportLimitOptions,
  DiagnosticReportSummary,
} from './vitest-diagnostics/index.mts'
