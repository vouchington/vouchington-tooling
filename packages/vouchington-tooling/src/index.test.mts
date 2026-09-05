import { describe, expect, it } from 'vitest'
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
  })
})
