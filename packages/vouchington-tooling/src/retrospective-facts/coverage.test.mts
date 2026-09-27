import { expect, it } from 'vitest'
import { runRetrospectiveFactsReport } from './index.mts'
import { completeCommandFacts } from './coverage.mts'

const valid = () => ({
  number: 1,
  state: 'OPEN',
  headRefName: 'topic',
  baseRefName: 'main',
  changedFiles: 0,
  files: [],
  commits: [],
})
it('reports failed, malformed and truncated GitHub facts explicitly', async () => {
  const collect = (stdout: string, ok = true) =>
    runRetrospectiveFactsReport({
      repo: 'owner/repo',
      pr: '1',
      execute: async () => ({ ok, stdout, stderr: '' }),
    })
  expect(await collect('', false)).toMatchObject({
    coverage: 'unavailable',
    markdown: expect.stringContaining('gh failed'),
  })
  for (const value of [
    '{',
    'null',
    '[]',
    ...[
      { number: 0 },
      { number: '1' },
      { state: ['OPEN'] },
      { state: 'unknown' },
      { headRefName: null },
      { headRefName: '' },
      { baseRefName: null },
      { baseRefName: '' },
      { changedFiles: -1 },
      { changedFiles: '0' },
      { files: null },
      { changedFiles: 1 },
      { changedFiles: 1, files: [null] },
      { changedFiles: 1, files: [{}] },
      { changedFiles: 1, files: [{ path: '' }] },
      { commits: null },
      { commits: Array(100).fill({}) },
      { state: 'MERGED', mergedAt: null },
      { state: 'MERGED', mergedAt: '' },
      { state: 'MERGED', mergedAt: '2026-01-01', mergeCommit: null },
      { state: 'MERGED', mergedAt: '2026-01-01', mergeCommit: {} },
      { state: 'MERGED', mergedAt: '2026-01-01', mergeCommit: { oid: '' } },
    ].map((change) => JSON.stringify({ ...valid(), ...change })),
  ])
    expect(await collect(value)).toMatchObject({ coverage: 'partial' })
  for (const value of [
    valid(),
    { ...valid(), state: 'MERGED', mergedAt: '2026-01-01', mergeCommit: { oid: 'a'.repeat(40) } },
    { ...valid(), changedFiles: 1, files: [{ path: 'src/file.mts' }] },
  ])
    expect(await collect(JSON.stringify(value))).toMatchObject({ coverage: 'complete' })
})
it('keeps local collection failures and invalid counted facts partial', async () => {
  expect(completeCommandFacts('git', ['branch'], { ok: true, stdout: '', stderr: '' })).toBe(false)
  expect(completeCommandFacts('git', ['branch'], { ok: true, stdout: 'topic', stderr: '' })).toBe(
    true,
  )
  expect(
    completeCommandFacts('git', ['rev-list'], { ok: true, stdout: 'unknown', stderr: '' }),
  ).toBe(false)
  expect(completeCommandFacts('git', ['rev-list'], { ok: true, stdout: '1', stderr: '' })).toBe(
    true,
  )
  const result = await runRetrospectiveFactsReport({
    noPr: true,
    execute: async (_command, args) => ({
      ok: args[0] !== 'fetch',
      stdout: args[0] === 'branch' ? 'topic' : '0',
      stderr: '',
    }),
  })
  expect(result.coverage).toBe('partial')
})
