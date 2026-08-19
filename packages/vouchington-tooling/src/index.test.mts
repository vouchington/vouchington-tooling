import { describe, expect, it } from 'vitest'
import {
  EphemeralListenerAttemptsExhaustedError,
  MissingSqlAstParserError,
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
  })
})
