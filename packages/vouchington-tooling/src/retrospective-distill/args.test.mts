import { describe, expect, it } from 'vitest'

import { parseDistillClassifyArgs } from './args.mts'

describe('parseDistillClassifyArgs', () => {
  it('parses the partition path and both cutoffs', () => {
    const args = parseDistillClassifyArgs([
      'partition.jsonl',
      '--retro-cutoff',
      '2026-08-01T00:00:00.000Z',
      '--session-cutoff',
      '2026-08-15T00:00:00.000Z',
    ])
    expect(args).toEqual({
      partitionPath: 'partition.jsonl',
      retroCutoff: '2026-08-01T00:00:00.000Z',
      sessionCutoff: '2026-08-15T00:00:00.000Z',
    })
  })

  it('throws when the partition path is missing', () => {
    expect(() =>
      parseDistillClassifyArgs(['--retro-cutoff', '2026-08-01', '--session-cutoff', '2026-08-15']),
    ).toThrow('expected exactly one positional argument')
  })

  it('throws when more than one positional argument is given', () => {
    expect(() =>
      parseDistillClassifyArgs([
        'a.jsonl',
        'b.jsonl',
        '--retro-cutoff',
        '2026-08-01',
        '--session-cutoff',
        '2026-08-15',
      ]),
    ).toThrow('expected exactly one positional argument')
  })

  it('throws when --retro-cutoff is missing', () => {
    expect(() => parseDistillClassifyArgs(['a.jsonl', '--session-cutoff', '2026-08-15'])).toThrow(
      '--retro-cutoff is required',
    )
  })

  it('throws when --session-cutoff is missing', () => {
    expect(() => parseDistillClassifyArgs(['a.jsonl', '--retro-cutoff', '2026-08-01'])).toThrow(
      '--session-cutoff is required',
    )
  })

  it('throws when a cutoff is not a valid timestamp', () => {
    expect(() =>
      parseDistillClassifyArgs([
        'a.jsonl',
        '--retro-cutoff',
        'not-a-date',
        '--session-cutoff',
        '2026-08-15',
      ]),
    ).toThrow('--retro-cutoff must be a valid ISO 8601 timestamp')
  })

  it('rejects an unknown flag', () => {
    expect(() =>
      parseDistillClassifyArgs([
        'a.jsonl',
        '--retro-cutoff',
        '2026-08-01',
        '--session-cutoff',
        '2026-08-15',
        '--bogus',
      ]),
    ).toThrow('unknown option: --bogus')
  })
})
