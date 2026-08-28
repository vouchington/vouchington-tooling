import { describe, expect, it } from 'vitest'

import { runPolicy, update } from './index.test-helpers.mts'

const metadata = [update('1.4.1', '1.5.0', 'version-update:semver-minor')]

describe('Dependabot auto-merge mutation response', () => {
  it('surfaces HTTP and GraphQL failures', async () => {
    await expect(runPolicy(metadata, {}, {}, 'merge-token', { status: 403 })).rejects.toThrow(
      'HTTP 403',
    )
    await expect(
      runPolicy(metadata, {}, {}, 'merge-token', { payload: { errors: [{ message: 'denied' }] } }),
    ).rejects.toThrow('denied')
  })

  it('fails closed for invalid JSON and unexpected success envelopes', async () => {
    await expect(
      runPolicy(metadata, {}, {}, 'merge-token', { jsonError: new SyntaxError('bad') }),
    ).rejects.toThrow('invalid JSON response')
    for (const payload of [
      {},
      { data: null },
      { data: { enablePullRequestAutoMerge: null } },
      { data: { enablePullRequestAutoMerge: {} } },
    ])
      await expect(runPolicy(metadata, {}, {}, 'merge-token', { payload })).rejects.toThrow(
        'unexpected response envelope',
      )
  })

  it('fails closed for an unexpected stale-disable response envelope', async () => {
    await expect(
      runPolicy(
        [update('1.9.0', '2.0.0', 'version-update:semver-major')],
        { auto_merge: { enabled_by: { login: 'example' } } },
        {},
        'merge-token',
        { payload: { data: { enablePullRequestAutoMerge: { clientMutationId: null } } } },
      ),
    ).rejects.toThrow('unexpected response envelope')

    await expect(
      runPolicy(
        [update('1.9.0', '2.0.0', 'version-update:semver-major')],
        { auto_merge: { enabled_by: { login: 'example' } } },
        {},
        'merge-token',
        { jsonError: new SyntaxError('bad') },
      ),
    ).rejects.toThrow('invalid JSON response')
  })
})
