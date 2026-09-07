import { describe, expect, it } from 'vitest'
import type { GitHubBodyLengthValidation } from './index.mts'
import {
  EphemeralListenerAttemptsExhaustedError,
  MissingSqlAstParserError,
  VITEST_BLOB_MANIFEST_VERSION,
  boundPendingLine,
  gitEnv,
  indexShapeKey,
  hashContractSchema,
  mintPresignedControl,
  pruneDeployedRuntimeDeps,
  SCC_COMPLEXITY_LIMIT,
  CHECKPOINT_MARKER,
  classifyFrictionObservation,
  dumpHarnessPolicy,
  INSTALL_TERMINATION_FAILED,
  isReleaseAgeViolation,
  isRunnerReservedPort,
  isProcessGroupAlive,
  lineOfUtf8ByteOffset,
  runnerPortPolicy,
  SELECTED_FILES_ENV_MAX_BYTES,
  validateNugetUpdate,
  normalizeSwiftSource,
  validateOptionalHttpOrigin,
  runPostReview,
  summarizeDiagnosticReport,
  waitForProcessGroupExit,
  checkGhaWorkspacePolicy,
  astGrepExamplesArguments,
  astGrepPackPaths,
  gitleaksDirectoryScanArguments,
  requireUpToDate,
  buildGhPrCreateArgs,
  createPullRequest,
  getDiffAgainstBase,
  HeadNotPushedError,
  HeadOutOfDateError,
  runGh,
  runGit,
  GITHUB_BODY_MAX_CHARACTERS,
  validateGitHubBodyLength,
} from './index.mts'

describe('package exports', () => {
  it('re-exports the public surface', () => {
    expect(isRunnerReservedPort(2200)).toBe(true)
    expect(runnerPortPolicy.portsPerRunner).toBe(16)
    expect(lineOfUtf8ByteOffset('a\nb', 2)).toBe(2)
    expect(new EphemeralListenerAttemptsExhaustedError(1).name).toBe(
      'EphemeralListenerAttemptsExhaustedError',
    )
    expect(new MissingSqlAstParserError().name).toBe('MissingSqlAstParserError')
    expect(VITEST_BLOB_MANIFEST_VERSION).toBe('vitest-blob-manifest:v1')
    expect(isReleaseAgeViolation('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION')).toBe(true)
    expect(INSTALL_TERMINATION_FAILED).toBe(-1)
    expect(typeof gitEnv).toBe('function')
    expect(SELECTED_FILES_ENV_MAX_BYTES).toBe(120_000)
    expect(() => validateOptionalHttpOrigin('')).not.toThrow()
    expect(boundPendingLine('ok')).toBe('ok')
    expect(indexShapeKey('idx', 'CREATE INDEX idx ON t (id)')).toBe('CREATE INDEX <name> ON t (id)')
    expect(hashContractSchema({ root: { type: 'string' }, definitions: {} })).toMatch(
      /^[0-9a-f]{64}$/,
    )
    expect(typeof mintPresignedControl).toBe('function')
    expect(typeof pruneDeployedRuntimeDeps).toBe('function')
    expect(SCC_COMPLEXITY_LIMIT).toBe(50)
    expect(CHECKPOINT_MARKER).toBe('pr-checkpoint:v1')
    expect(typeof classifyFrictionObservation).toBe('function')
    expect(dumpHarnessPolicy().cursor.approvalMode).toBe('auto-review')
    expect(typeof validateNugetUpdate).toBe('function')
    expect(normalizeSwiftSource('let  x = 1')).toBe('letx=1')
    expect(typeof runPostReview).toBe('function')
    expect(typeof summarizeDiagnosticReport).toBe('function')
    expect(typeof isProcessGroupAlive).toBe('function')
    expect(typeof waitForProcessGroupExit).toBe('function')
    expect(typeof checkGhaWorkspacePolicy).toBe('function')
    expect(typeof requireUpToDate).toBe('function')
    expect(gitleaksDirectoryScanArguments({ config: '.gitleaks.toml' })).toContain('--config')
    expect(astGrepExamplesArguments({ rules: 'rules', config: 'sgconfig.yml' })).toContain('test')
    expect(astGrepPackPaths().config).toMatch(/sgconfig\.yml$/)
    expect(typeof runGh).toBe('function')
    expect(typeof runGit).toBe('function')
    expect(buildGhPrCreateArgs({ title: 't', bodyFile: 'body.md', head: 'x' })).toContain('--head')
    expect(typeof createPullRequest).toBe('function')
    expect(typeof getDiffAgainstBase).toBe('function')
    expect(new HeadNotPushedError('x', 'origin').name).toBe('HeadNotPushedError')
    expect(new HeadOutOfDateError('x', 'origin').name).toBe('HeadOutOfDateError')
    const bodyLength: GitHubBodyLengthValidation = validateGitHubBodyLength('😀')
    expect(GITHUB_BODY_MAX_CHARACTERS).toBe(65_536)
    expect(bodyLength).toEqual({
      ok: true,
      characterCount: 1,
      utf8ByteCount: 4,
      maxCharacterCount: GITHUB_BODY_MAX_CHARACTERS,
    })
  })
})
