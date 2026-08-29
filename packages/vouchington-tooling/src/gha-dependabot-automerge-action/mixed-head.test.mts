import { describe, expect, it } from 'vitest'

import { runPolicy } from './index.test-helpers.mts'

describe('Dependabot auto-merge mixed or unverified HEAD', () => {
  it('no-ops when fetch-metadata fails on a trusted Dependabot PR', async () => {
    const result = await runPolicy(
      '',
      {},
      {},
      'merge-token',
      {},
      undefined,
      undefined,
      undefined,
      '[]',
      {},
      undefined,
      'failure',
    )
    expect(result.failures).toEqual([])
    expect(result.mutationRequests).toEqual([])
    expect(result.infos.join('\n')).toContain(
      'Dependabot metadata unavailable (unsigned or non-Dependabot HEAD)',
    )
  })

  it('disables stale auto-merge when fetch-metadata fails and auto-merge is armed', async () => {
    const result = await runPolicy(
      '',
      { auto_merge: { merge_method: 'squash' } },
      {},
      'merge-token',
      {},
      undefined,
      undefined,
      undefined,
      '[]',
      {},
      undefined,
      'failure',
    )
    expect(result.failures).toEqual([])
    expect(result.mutationRequests).toHaveLength(1)
    expect(result.mutationRequests[0]?.body).toContain('disablePullRequestAutoMerge')
    expect(result.infos.join('\n')).toContain('stale auto-merge disabled')
  })
})
