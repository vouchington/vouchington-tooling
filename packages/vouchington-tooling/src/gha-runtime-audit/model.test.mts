import { describe, expect, it } from 'vitest'

import { parseArray, parseObject, parseRun, parseSample, parseWorkflow } from './model.mts'
import { makeJob, makeRun } from './index.test-helpers.mts'

describe('gha-runtime-audit model', () => {
  it('rejects malformed objects, strings, numbers, and arrays', () => {
    expect(() => parseObject(null, 'obj')).toThrow('Malformed GitHub API')
    expect(() => parseObject([], 'obj')).toThrow('Malformed GitHub API')
    expect(() => parseObject('x', 'obj')).toThrow('Malformed GitHub API')
    expect(() => parseArray({}, 'arr')).toThrow('Malformed GitHub API')
    expect(() => parseWorkflow({ id: 0, name: 'CI', state: 'active' })).toThrow('positive integer')
    expect(() => parseWorkflow({ id: 1.5, name: 'CI', state: 'active' })).toThrow(
      'positive integer',
    )
    expect(() => parseWorkflow({ id: '1', name: 'CI', state: 'active' })).toThrow(
      'positive integer',
    )
    expect(() => parseWorkflow({ id: 1, name: '', state: 'active' })).toThrow('non-empty string')
    expect(() => parseWorkflow({ id: 1, name: 1, state: 'active' })).toThrow('non-empty string')
    expect(() => parseWorkflow({ id: 1, name: 'CI', state: '' })).toThrow('non-empty string')
  })

  it('rejects malformed run fields and timestamps', () => {
    const valid = makeRun(1, 'CI', 'pull_request') as Record<string, unknown>
    expect(() => parseRun(null)).toThrow('workflow run must be an object')
    expect(() => parseRun({ ...valid, pull_requests: 'x' })).toThrow(
      'pull_requests must be an array',
    )
    expect(() => parseRun({ ...valid, pull_requests: [null] })).toThrow('must be an object')
    expect(() => parseRun({ ...valid, pull_requests: [{ base: 'x' }] })).toThrow(
      'must be an object',
    )
    expect(() => parseRun({ ...valid, pull_requests: [{ base: { ref: 1 } }] })).toThrow(
      'must be a string',
    )
    expect(() => parseRun({ ...valid, event: '' })).toThrow('non-empty string')
    expect(() => parseRun({ ...valid, conclusion: '' })).toThrow('non-empty string')
    expect(() => parseRun({ ...valid, html_url: '' })).toThrow('non-empty string')
    expect(() => parseRun({ ...valid, created_at: 'not-iso' })).toThrow('ISO timestamp')
    expect(() => parseRun({ ...valid, created_at: '' })).toThrow('non-empty string')
    expect(() => parseRun({ ...valid, head_branch: '' })).toThrow('head_branch')
    expect(() => parseRun({ ...valid, head_branch: 1 })).toThrow('head_branch')
    expect(parseRun({ ...valid, head_branch: null }).headBranch).toBeNull()
  })

  it('rejects malformed job samples and skips unsuccessful jobs', () => {
    const run = parseRun(makeRun(1, 'CI', 'pull_request'))
    expect(() => parseSample(null, run)).toThrow('must be an object')
    expect(parseSample(makeJob(1, 'failed', 10, 0, 'failure'), run)).toBeNull()
    expect(() => parseSample({ ...makeJob(1, 'test', 10), started_at: 'nope' }, run)).toThrow(
      'ISO timestamp',
    )
    expect(() => parseSample({ ...makeJob(1, 'test', 10), name: '' }, run)).toThrow(
      'must be a non-empty string',
    )
    expect(() => parseSample({ ...makeJob(1, 'test', 10), id: 0 }, run)).toThrow('positive integer')
    expect(() => parseSample({ ...makeJob(1, 'test', 10), html_url: '' }, run)).toThrow(
      'must be a string',
    )
  })

  it('parses a successful workflow and run', () => {
    expect(parseWorkflow({ id: 1, name: 'CI', state: 'active' })).toEqual({
      id: 1,
      name: 'CI',
      state: 'active',
    })
    expect(parseObject({ a: 1 }, 'obj')).toEqual({ a: 1 })
    expect(parseArray([1], 'arr')).toEqual([1])
  })
})
