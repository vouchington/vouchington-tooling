import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LABEL_POLICY,
  labelMetadata,
  parseLabelPolicy,
  readLabelPolicyFile,
} from './label-policy.mts'

const policy = parseLabelPolicy({
  labels: { 'tier: one': { color: 'b60205', description: 'Top tier.' } },
  strictPrefixes: ['tier:'],
  defaultColor: 'ABCDEF',
  defaultDescription: 'Label {name} ({name}).',
})

describe('labelMetadata', () => {
  it('returns explicit entries and templated defaults', () => {
    expect(labelMetadata('tier: one', policy)).toEqual({
      color: 'b60205',
      description: 'Top tier.',
    })
    expect(labelMetadata('plain', policy)).toEqual({
      color: 'ABCDEF',
      description: 'Label plain (plain).',
    })
    expect(labelMetadata('plain')).toEqual({
      color: 'EDEDED',
      description: 'Repository issue classification: plain.',
    })
  })

  it('rejects unlisted names under a strict prefix', () => {
    expect(() => labelMetadata('tier: two', policy)).toThrow('unsupported tier: label: tier: two')
  })

  it('does not treat inherited object keys as explicit entries', () => {
    expect(labelMetadata('toString', policy).color).toBe('ABCDEF')
  })
})

describe('parseLabelPolicy', () => {
  it('uses defaults for omitted fields', () => {
    expect(parseLabelPolicy({})).toEqual(DEFAULT_LABEL_POLICY)
  })

  it.each([
    [null, 'label policy must be a JSON object'],
    [[], 'label policy must be a JSON object'],
    [{ labels: [] }, 'labels must be an object'],
    [{ labels: { a: 1 } }, 'labels.a must be an object'],
    [{ labels: { a: { color: 'x' } } }, 'labels.a.description must be a non-empty string'],
    [{ labels: { a: { color: '', description: 'd' } } }, 'labels.a.color must be a non-empty'],
    [{ strictPrefixes: 'x' }, 'strictPrefixes must be an array of strings'],
    [{ strictPrefixes: [1] }, 'strictPrefixes must be an array of strings'],
    [{ defaultColor: 1 }, 'defaultColor must be a non-empty string'],
    [{ defaultDescription: '' }, 'defaultDescription must be a non-empty string'],
  ])('rejects invalid policy %#', (input, message) => {
    expect(() => parseLabelPolicy(input)).toThrow(message)
  })

  it('reads a policy from a JSON file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'label-policy-'))
    try {
      const file = join(dir, 'policy.json')
      await writeFile(file, JSON.stringify({ defaultColor: '000000' }))
      expect(readLabelPolicyFile(file).defaultColor).toBe('000000')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
