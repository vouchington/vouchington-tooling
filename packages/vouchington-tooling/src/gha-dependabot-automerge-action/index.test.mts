import { describe, expect, it } from 'vitest'

import { runPolicy, type ScriptResult, update } from './index.test-helpers.mts'

function expectAutoMergeEnabled(result: ScriptResult): void {
  expect(result.failures).toEqual([])
  expect(result.mutationRequests).toHaveLength(1)
  const request = result.mutationRequests[0]
  expect(request).toMatchObject({
    headers: {
      authorization: 'Bearer merge-token',
      'user-agent': 'dependabot-automerge-action',
    },
    method: 'POST',
    url: 'https://github.example.test/api/graphql',
  })
  const body = JSON.parse(request?.body ?? '') as {
    query: string
    variables: Record<string, string>
  }
  expect(body.variables).toEqual({
    expectedHeadOid: 'b'.repeat(40),
    pullRequestId: 'PR_node_id',
  })
  expect(body.query).toContain('expectedHeadOid: $expectedHeadOid')
  expect(body.query).toContain('mergeMethod: SQUASH')
}

function expectHumanAction(result: ScriptResult): void {
  expect(result.failures).toEqual([])
  expect(result.mutationRequests).toEqual([])
  expect([...result.infos, ...result.warnings].join('\n')).toContain('Human action required')
}

describe('Dependabot auto-merge action policy', () => {
  it('enables auto-merge for stable patch and minor updates', async () => {
    for (const candidate of [
      update('1.4.1', '1.4.2', 'version-update:semver-patch'),
      update('1.4.1', '1.5.0', 'version-update:semver-minor'),
    ])
      expectAutoMergeEnabled(await runPolicy([candidate]))
  })

  it('allows stable patch updates at any version, including build metadata', async () => {
    for (const candidate of [
      update('0.4.1', '0.4.2', 'version-update:semver-patch'),
      update('1.4.1+build.1', '1.4.2+build.2', 'version-update:semver-patch'),
    ])
      expectAutoMergeEnabled(await runPolicy([candidate]))
  })

  it('requires human action for major and unstable minor group members', async () => {
    const result = await runPolicy([
      update('0.44.1', '0.45.0', 'version-update:semver-minor', 'prestable'),
      update('1.4.0-beta.1', '1.5.0-beta.1', 'version-update:semver-minor', 'prerelease'),
      update('1.4.1', '1.4.2-beta.1', 'version-update:semver-patch', 'prerelease patch'),
      update('1.4.1-beta.1', '1.4.2', 'version-update:semver-patch', 'prerelease source'),
      update('1.9.0', '2.0.0', 'version-update:semver-major', 'major'),
    ])
    expectHumanAction(result)
    expect(result.infos.join('\n')).toContain('prestable')
    expect(result.infos.join('\n')).toContain('prerelease')
    expect(result.infos.join('\n')).toContain('prerelease patch')
    expect(result.infos.join('\n')).toContain('prerelease source')
    expect(result.infos.join('\n')).toContain('major')
  })

  it('fails closed for malformed, inconsistent, or non-increasing metadata', async () => {
    for (const metadata of ['', '{not json', []]) {
      const result = await runPolicy(metadata)
      expect(result.failures.join('\n')).toContain('Dependabot metadata')
      expect(result.mutationRequests).toEqual([])
    }
    for (const metadata of [
      [update('1.0.0', '1.0.1', 'version-update:semver-unknown')],
      [update('not-semver', '1.0.1', 'version-update:semver-patch')],
      [update('1.0.1', '1.0.1', 'version-update:semver-patch')],
      [update('1.0.1+build.1', '1.0.1+build.2', 'version-update:semver-patch')],
      [update('1.0.0', '2.0.0', 'version-update:semver-patch')],
    ])
      expectHumanAction(await runPolicy(metadata))
  })

  it('honors configured manual rules before attempting a mutation', async () => {
    const result = await runPolicy(
      [
        {
          ...update('1.4.1', '1.4.2', 'version-update:semver-patch'),
          directory: '/native',
          packageEcosystem: 'nuget',
        },
      ],
      {},
      {},
      'merge-token',
      {},
      { directory: '/native', ecosystem: 'nuget' },
      undefined,
      undefined,
      '[{"packageEcosystem":"nuget","directory":"/native"}]',
    )
    expectHumanAction(result)

    const grouped = await runPolicy(
      [
        update('1.4.1', '1.4.2', 'version-update:semver-patch'),
        { ...update('2.0.0', '2.0.1', 'version-update:semver-patch'), directory: '/native' },
      ],
      {},
      {},
      'merge-token',
      {},
      undefined,
      undefined,
      undefined,
      '[{"packageEcosystem":"npm","directory":"/native"}]',
    )
    expectHumanAction(grouped)

    expectAutoMergeEnabled(
      await runPolicy(
        [update('1.4.1', '1.4.2', 'version-update:semver-patch')],
        {},
        {},
        'merge-token',
        {},
        undefined,
        undefined,
        undefined,
        '[{"packageEcosystem":"npm","directory":"/elsewhere"}]',
      ),
    )
  })

  it('disables stale auto-merge when a synchronized update becomes ineligible', async () => {
    const result = await runPolicy([update('1.9.0', '2.0.0', 'version-update:semver-major')], {
      auto_merge: { enabled_by: { login: 'example' } },
    })
    expect(result.failures).toEqual([])
    expect(result.mutationRequests).toHaveLength(1)
    const body = JSON.parse(result.mutationRequests[0]?.body ?? '') as {
      query: string
      variables: Record<string, string>
    }
    expect(body.query).toContain('disablePullRequestAutoMerge')
    expect(body.variables).toEqual({ pullRequestId: 'PR_node_id' })
    expect(result.infos.join('\n')).toContain('stale auto-merge disabled')

    const invalidRules = await runPolicy(
      [update('1.4.1', '1.4.2', 'version-update:semver-patch')],
      { auto_merge: { enabled_by: { login: 'example' } } },
      {},
      'merge-token',
      {},
      undefined,
      undefined,
      undefined,
      '{invalid',
    )
    expect(invalidRules.mutationRequests).toHaveLength(1)
    expect(invalidRules.failures.join('\n')).toContain('MANUAL_UPDATE_RULES')

    for (const rules of [
      '[{"directory":"/"}]',
      '[{"packageEcosystem":"npm"}]',
      '[{"packageEcosystem":" ","directory":"/"}]',
      '[{"packageEcosystem":"npm","directory":"native"}]',
    ]) {
      const invalidSchema = await runPolicy(
        [update('1.4.1', '1.4.2', 'version-update:semver-patch')],
        {},
        {},
        'merge-token',
        {},
        undefined,
        undefined,
        undefined,
        rules,
      )
      expect(invalidSchema.failures.join('\n')).toContain('MANUAL_UPDATE_RULES')
      expect(invalidSchema.mutationRequests).toEqual([])
    }
  })

  it('uses expected post-processing SHAs and the refreshed node id', async () => {
    const base = 'c'.repeat(40)
    const head = 'd'.repeat(40)
    const result = await runPolicy(
      [update('1.4.1', '1.5.0', 'version-update:semver-minor')],
      {},
      {
        base: { ref: 'main', sha: base },
        head: {
          ref: 'dependabot/npm_and_yarn/example-1.5.0',
          repo: { full_name: 'example-owner/example-repo' },
          sha: head,
        },
        node_id: 'fresh',
      },
      'merge-token',
      {},
      undefined,
      base,
      head,
    )
    expect(result.restGetCalls).toEqual([
      { owner: 'example-owner', pull_number: 123, repo: 'example-repo' },
      { owner: 'example-owner', pull_number: 123, repo: 'example-repo' },
    ])
    expect(JSON.parse(result.mutationRequests[0]?.body ?? '').variables).toEqual({
      expectedHeadOid: head,
      pullRequestId: 'fresh',
    })
  })

  it('fails closed for invalid expected SHAs and a draft, closed, or merged live PR', async () => {
    const candidate = [update('1.4.1', '1.5.0', 'version-update:semver-minor')]
    const invalidSha = await runPolicy(candidate, {}, {}, 'merge-token', {}, undefined, 'invalid')
    expect(invalidSha.failures.join('\n')).toContain('Expected base and head SHAs')
    expect(invalidSha.restGetCalls).toHaveLength(1)

    const staleInvalidSha = await runPolicy(
      candidate,
      { auto_merge: { merge_method: 'squash' } },
      {},
      'merge-token',
      {},
      undefined,
      'invalid',
    )
    expect(staleInvalidSha.mutationRequests).toHaveLength(1)
    expect(staleInvalidSha.failures.join('\n')).toContain('Expected base and head SHAs')

    const initialRefreshFailure = await runPolicy(
      candidate,
      { auto_merge: { merge_method: 'squash' } },
      {},
      'merge-token',
      {},
      undefined,
      undefined,
      undefined,
      '[]',
      {},
      new Error('API unavailable'),
    )
    expect(initialRefreshFailure.mutationRequests).toHaveLength(1)
    expect(initialRefreshFailure.failures.join('\n')).toContain('Unable to refresh')

    const staleDraft = await runPolicy(
      candidate,
      {},
      {
        auto_merge: { merge_method: 'squash' },
        draft: true,
      },
    )
    expect(staleDraft.mutationRequests).toHaveLength(1)
    expect(staleDraft.mutationRequests[0]?.body).toContain('disablePullRequestAutoMerge')

    for (const fresh of [{ draft: true }, { state: 'closed' }, { merged: true }]) {
      const result = await runPolicy(candidate, {}, fresh)
      expectHumanAction(result)
    }

    for (const fresh of [
      { base: { ref: 'release', sha: 'a'.repeat(40) } },
      {
        head: {
          ref: 'feature',
          repo: { full_name: 'example-owner/example-repo' },
          sha: 'b'.repeat(40),
        },
      },
      {
        head: {
          ref: 'dependabot/npm/example',
          repo: { full_name: 'other/repo' },
          sha: 'b'.repeat(40),
        },
      },
    ])
      expectHumanAction(await runPolicy(candidate, {}, fresh))

    const alreadyEnabled = await runPolicy(
      candidate,
      {},
      {
        auto_merge: { merge_method: 'squash' },
      },
    )
    expect(alreadyEnabled.failures).toEqual([])
    expect(alreadyEnabled.mutationRequests).toEqual([])
    expect(alreadyEnabled.infos).toContain('Done: auto-merge already enabled')

    const wrongMethod = await runPolicy(candidate, {}, { auto_merge: { merge_method: 'merge' } })
    expect(wrongMethod.failures).toEqual([])
    expect(wrongMethod.mutationRequests).toEqual([])
    expect(wrongMethod.infos).toContain('Done: auto-merge already enabled')
  })

  it('disables auto-merge if the trusted PR changes while it is enabled', async () => {
    for (const changed of [{ base: { ref: 'release', sha: 'c'.repeat(40) } }, { draft: true }]) {
      const result = await runPolicy(
        [update('1.4.1', '1.5.0', 'version-update:semver-minor')],
        {},
        {},
        'merge-token',
        {},
        undefined,
        undefined,
        undefined,
        '[]',
        changed,
      )
      expect(result.mutationRequests).toHaveLength(2)
      expect(result.mutationRequests[1]?.body).toContain('disablePullRequestAutoMerge')
      expect(result.failures).toContain('Pull request changed while auto-merge was enabled')
    }

    const merged = await runPolicy(
      [update('1.4.1', '1.5.0', 'version-update:semver-minor')],
      {},
      {},
      'merge-token',
      {},
      undefined,
      undefined,
      undefined,
      '[]',
      { merged: true, state: 'closed' },
    )
    expect(merged.mutationRequests).toHaveLength(1)
    expect(merged.failures).toEqual([])
    expect(merged.infos).toContain('Done: auto-merge completed')

    const closed = await runPolicy(
      [update('1.4.1', '1.5.0', 'version-update:semver-minor')],
      {},
      {},
      'merge-token',
      {},
      undefined,
      undefined,
      undefined,
      '[]',
      { state: 'closed' },
    )
    expect(closed.mutationRequests).toHaveLength(1)
    expect(closed.failures).toContain('Pull request changed while auto-merge was enabled')

    const refreshFailure = await runPolicy(
      [update('1.4.1', '1.5.0', 'version-update:semver-minor')],
      {},
      {},
      'merge-token',
      {},
      undefined,
      undefined,
      undefined,
      '[]',
      new Error('API unavailable'),
    )
    expect(refreshFailure.mutationRequests).toHaveLength(2)
    expect(refreshFailure.mutationRequests[1]?.body).toContain('disablePullRequestAutoMerge')
    expect(refreshFailure.failures.join('\n')).toContain('Unable to revalidate')
  })
})
