import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  assertCoverageTransportBlobOutcome,
  assertCoverageTransportOutcome,
  isBlobPrimaryState,
  isStepOutcome,
  writeUploadOutcomeOutput,
} from './outcome.mts'

describe('coverage transport outcome guards', () => {
  it('narrows step outcomes and blob primary states', () => {
    expect(isStepOutcome('success')).toBe(true)
    expect(isStepOutcome('failure')).toBe(true)
    expect(isStepOutcome(undefined)).toBe(false)
    expect(isStepOutcome('unknown')).toBe(false)
    expect(isBlobPrimaryState('true')).toBe(true)
    expect(isBlobPrimaryState('skipped')).toBe(true)
    expect(isBlobPrimaryState(undefined)).toBe(false)
    expect(isBlobPrimaryState('maybe')).toBe(false)
  })

  it('accepts either complete transport family and warns when the peer is degraded', () => {
    const lines: string[] = []
    expect(assertCoverageTransportOutcome('fixture', 'success', 'success', 'skipped')).toBe(true)
    expect(lines).toEqual([])
    const writes: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      expect(assertCoverageTransportOutcome('fixture', 'success', 'failure', 'failure')).toBe(true)
      expect(assertCoverageTransportBlobOutcome('fixture', 'false', 'success', 'skipped')).toBe(
        true,
      )
    } finally {
      process.stderr.write = original
    }
    expect(writes.join('')).toContain('Coverage persisted only to S3')
    expect(writes.join('')).toContain('Vitest blob persisted only to GitHub artifacts')
    expect(
      assertCoverageTransportOutcome('fixture', 'success', 'failure', 'failure', (line) =>
        lines.push(line),
      ),
    ).toBe(true)
    expect(lines).toEqual([
      '::warning::Coverage persisted only to S3 for suite=fixture; GitHub artifact fallback is degraded.',
    ])

    lines.length = 0
    expect(
      assertCoverageTransportOutcome('fixture', 'failure', 'failure', 'success', (line) =>
        lines.push(line),
      ),
    ).toBe(true)
    expect(lines).toEqual([
      '::warning::Coverage persisted only to GitHub artifacts for suite=fixture; S3 primary is degraded.',
    ])
  })

  it('fails with a focused URL-free marker when every coverage transport is exhausted', () => {
    const lines: string[] = []
    expect(
      assertCoverageTransportOutcome('fixture', 'failure', 'failure', 'failure', (line) =>
        lines.push(line),
      ),
    ).toBe(false)
    expect(lines).toEqual([
      '::error::COVERAGE_TRANSPORT_EXHAUSTED suite=fixture Neither S3 nor GitHub artifacts persisted the coverage pair.',
    ])
    expect(lines.join('\n')).not.toMatch(/https?:/)
  })

  it('does not warn that S3 is degraded when the coverage primary step never ran', () => {
    const lines: string[] = []
    expect(
      assertCoverageTransportOutcome('fixture', 'skipped', 'success', 'skipped', (line) =>
        lines.push(line),
      ),
    ).toBe(true)
    expect(lines).toEqual([])
  })

  it('writes blob=true|false to $GITHUB_OUTPUT and is a no-op without a path', () => {
    const root = mkdtempSync(join(tmpdir(), 'coverage-output-'))
    const outputPath = join(root, 'github-output')
    writeFileSync(outputPath, 'existing=line\n')

    writeUploadOutcomeOutput({ blob: true }, outputPath)
    expect(readFileSync(outputPath, 'utf8')).toBe('existing=line\nblob=true\n')

    const appended: Array<[string, string]> = []
    writeUploadOutcomeOutput({ blob: false }, undefined, (path, data) =>
      appended.push([path, data]),
    )
    expect(appended).toEqual([])
  })

  it('accepts a persisted blob primary or a successful fallback, and warns when the peer is degraded', () => {
    const lines: string[] = []
    expect(
      assertCoverageTransportBlobOutcome('fixture', 'true', 'success', 'skipped', (line) =>
        lines.push(line),
      ),
    ).toBe(true)
    expect(lines).toEqual([])

    expect(
      assertCoverageTransportBlobOutcome('fixture', 'true', 'failure', 'cancelled', (line) =>
        lines.push(line),
      ),
    ).toBe(true)
    expect(lines).toEqual([
      '::warning::Vitest blob persisted only to S3 for suite=fixture; GitHub artifact fallback is degraded.',
    ])

    lines.length = 0
    expect(
      assertCoverageTransportBlobOutcome('fixture', 'false', 'failure', 'success', (line) =>
        lines.push(line),
      ),
    ).toBe(true)
    expect(lines).toEqual([
      '::warning::Vitest blob persisted only to GitHub artifacts for suite=fixture; S3 primary is degraded.',
    ])
  })

  it('does not warn that S3 is degraded when the primary step never ran', () => {
    const lines: string[] = []
    expect(
      assertCoverageTransportBlobOutcome('fixture', 'skipped', 'success', 'skipped', (line) =>
        lines.push(line),
      ),
    ).toBe(true)
    expect(lines).toEqual([])
  })

  it('fails with a focused marker when neither S3 nor GitHub persisted the vitest blob', () => {
    const lines: string[] = []
    expect(
      assertCoverageTransportBlobOutcome('fixture', 'false', 'failure', 'failure', (line) =>
        lines.push(line),
      ),
    ).toBe(false)
    expect(lines).toEqual([
      '::error::COVERAGE_TRANSPORT_BLOB_EXHAUSTED suite=fixture Neither S3 nor GitHub artifacts persisted the vitest blob.',
    ])
    lines.length = 0
    expect(
      assertCoverageTransportBlobOutcome('fixture', 'skipped', 'failure', 'failure', (line) =>
        lines.push(line),
      ),
    ).toBe(false)
    expect(lines.join('\n')).toContain('COVERAGE_TRANSPORT_BLOB_EXHAUSTED')
  })
})
