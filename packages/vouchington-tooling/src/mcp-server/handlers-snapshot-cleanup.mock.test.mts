import { beforeEach, describe, expect, it, vi } from 'vitest'
import { harness, jsonOf, textOf, useRepoFixture } from './harness.test-helpers.mts'
import { createSnapshotRegistry } from './snapshot-registry.mts'

const cleanup = vi.hoisted(() => vi.fn())
vi.mock('../agent-blackboard/index.mts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent-blackboard/index.mts')>()),
  cleanupSnapshotPartitions: cleanup,
}))

const fixture = useRepoFixture()
const receipt = { schemaVersion: 1, token: 'receipt-token', signature: 'sig' }
const OWNER = 'native:owner'

beforeEach(() => {
  cleanup.mockReset()
})

async function exportToken(exportResult: unknown, extra: Record<string, unknown> = {}) {
  const h = harness(fixture(), { snapshots: createSnapshotRegistry(), exportResult })
  const result = jsonOf(await h.call('snapshot_export', { sessionId: OWNER, ...extra }))
  return { h, result, cleanupToken: result.cleanupToken as string }
}

describe('snapshot_cleanup partitions', () => {
  it('cleans the recorded partition directory with its recorded receipt only', async () => {
    const reported = {
      path: '/tmp/agent-blackboard-snapshot-x.jsonl',
      directory: '/tmp/agent-blackboard-partitions-abc',
      cleanupReceipt: receipt,
    }
    const { h, result, cleanupToken } = await exportToken(reported)
    expect(result.directory).toBe(reported.directory)
    await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
    expect(cleanup).toHaveBeenCalledExactlyOnceWith({
      path: reported.path,
      directory: reported.directory,
      receipt,
    })
  })

  it('records a directory only when the client reported a receipt too', async () => {
    const path = '/tmp/agent-blackboard-snapshot-x.jsonl'
    for (const extra of [{ directory: '/tmp/d' }, { cleanupReceipt: receipt }]) {
      cleanup.mockClear()
      const { h, cleanupToken } = await exportToken({ path, ...extra })
      await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
      expect(cleanup).toHaveBeenCalledExactlyOnceWith({ path })
    }
  })

  it('surfaces the retained tombstone path and keeps the token for a retry', async () => {
    const path = '/tmp/agent-blackboard-snapshot-x.jsonl'
    cleanup.mockRejectedValueOnce(
      new AggregateError([], 'snapshot cleanup failed: retained tombstone /tmp/.t for retry'),
    )
    const { h, cleanupToken } = await exportToken({ path })
    const failed = await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
    expect(failed.isError).toBe(true)
    expect(textOf(failed)).toContain('retained tombstone /tmp/.t for retry')
    cleanup.mockRejectedValueOnce('plain failure')
    expect(textOf(await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken }))).toContain(
      'plain failure',
    )
    const retried = await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
    expect(retried.isError).toBeUndefined()
    expect(cleanup).toHaveBeenCalledTimes(3)
  })
})
