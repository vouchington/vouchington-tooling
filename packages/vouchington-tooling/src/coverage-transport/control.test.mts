import { chmodSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseTransportControl, readTransportControl, writeTransportControl } from './control.mts'

const identity = {
  version: 1 as const,
  repository: 'owner/repo',
  revision: 'a'.repeat(40),
  run: { id: '1', controlAttempt: 1 },
}

describe('parseTransportControl', () => {
  it('rejects unsupported schemas and identity fields', () => {
    expect(() => parseTransportControl(null)).toThrow(/unsupported schema/)
    expect(() => parseTransportControl({ version: 2, run: {} })).toThrow(/unsupported schema/)
    expect(() => parseTransportControl({ ...identity, run: 'nope' })).toThrow(/unsupported schema/)
    expect(() =>
      parseTransportControl({ ...identity, repository: '', mode: 'fallback-only', reason: 'x' }),
    ).toThrow(/invalid identity fields/)
    expect(() =>
      parseTransportControl({
        ...identity,
        mode: 'fallback-only',
        reason: '',
      }),
    ).toThrow(/Fallback-only/)
    expect(() =>
      parseTransportControl({
        ...identity,
        mode: 'presigned',
        expiresAt: 'not-a-date',
        coverage: {},
        blobs: {},
      }),
    ).toThrow(/Presigned coverage transport control is invalid/)
  })

  it('rejects malformed URL maps', () => {
    const base = {
      ...identity,
      mode: 'presigned' as const,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      coverage: {},
      blobs: {},
    }
    expect(() => parseTransportControl({ ...base, coverage: 'nope' })).toThrow(
      'Coverage URL map must be an object',
    )
    expect(() =>
      parseTransportControl({
        ...base,
        coverage: {
          'not a suite': {
            lcovGet: 'https://x',
            lcovPut: 'https://x',
            manifestGet: 'https://x',
            manifestPut: 'https://x',
          },
        },
      }),
    ).toThrow('Coverage URL map has an invalid entry')
    expect(() =>
      parseTransportControl({
        ...base,
        coverage: {
          web: {
            lcovGet: 'ftp://example.test/a',
            lcovPut: 'https://example.test/a',
            manifestGet: 'https://example.test/a',
            manifestPut: 'https://example.test/a',
          },
        },
      }),
    ).toThrow('Coverage URL map has an invalid URL')
  })

  it('rejects a control whose attempt is ahead of the current run', () => {
    const root = mkdtempSync(join(tmpdir(), 'coverage-control-'))
    const path = join(root, 'control.json')
    writeTransportControl(path, {
      ...identity,
      mode: 'fallback-only',
      reason: 'presign unavailable',
    })
    chmodSync(path, 0o600)
    expect(() =>
      readTransportControl(path, {
        repository: 'owner/repo',
        revision: 'a'.repeat(40),
        runId: '1',
        currentAttempt: 0,
      }),
    ).toThrow(/identity/)
  })
})
