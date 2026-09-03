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

  it('treats an already-mergeable rejection as a no-op, not a failure', async () => {
    for (const status of ['clean', 'unstable']) {
      const result = await runPolicy(metadata, {}, {}, 'merge-token', {
        payload: { errors: [{ message: `Pull request Pull request is in ${status} status` }] },
      })
      expect(result.failures).toEqual([])
      expect(result.mutationRequests).toHaveLength(1)
      expect(result.warnings).toContain(
        `Done: pull request is already mergeable, auto-merge not needed (Pull request Pull request is in ${status} status)`,
      )
    }
  })

  it('also tolerates the message without the duplicated "Pull request" prefix', async () => {
    const result = await runPolicy(metadata, {}, {}, 'merge-token', {
      payload: { errors: [{ message: 'Pull request is in clean status' }] },
    })
    expect(result.failures).toEqual([])
    expect(result.warnings).toContain(
      'Done: pull request is already mergeable, auto-merge not needed (Pull request is in clean status)',
    )
  })

  it('still fails closed when only one of several GraphQL errors is the already-mergeable rejection', async () => {
    await expect(
      runPolicy(metadata, {}, {}, 'merge-token', {
        payload: {
          errors: [
            { message: 'Pull request Pull request is in clean status' },
            { message: 'denied' },
          ],
        },
      }),
    ).rejects.toThrow('denied')
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
