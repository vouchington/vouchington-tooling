import { describe, expect, it } from 'vitest'
import {
  EphemeralListenerAttemptsExhaustedError,
  MissingSqlAstParserError,
  VITEST_BLOB_MANIFEST_VERSION,
  gitEnv,
  isReleaseAgeViolation,
  isRunnerReservedPort,
  lineOfUtf8ByteOffset,
  runnerPortPolicy,
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
    expect(typeof gitEnv).toBe('function')
  })
})
