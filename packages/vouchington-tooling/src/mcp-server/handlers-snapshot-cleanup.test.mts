import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { harness, jsonOf, textOf, useRepoFixture } from './harness.test-helpers.mts'
import { createSnapshotRegistry, type SnapshotRegistry } from './snapshot-registry.mts'

const fixture = useRepoFixture()
const OWNER = 'native:owner'
const created: string[] = []

function snapshotFile(): string {
  const path = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  writeFileSync(path, '{}\n')
  created.push(path)
  return path
}

function exportAs(registry: SnapshotRegistry, path: string, worktree?: string) {
  const h = harness(fixture(), { snapshots: registry, exportResult: { path } })
  return {
    h,
    token: async (sessionId = OWNER) => {
      const result = jsonOf(await h.call('snapshot_export', { sessionId, worktree }))
      return result.cleanupToken as string
    },
  }
}

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('snapshot_cleanup', () => {
  it('deletes the exported file with a server-minted token and spends the token', async () => {
    const path = snapshotFile()
    const { h, token } = exportAs(createSnapshotRegistry(), path)
    const cleanupToken = await token()
    expect(cleanupToken).not.toBe('client-token')
    expect(existsSync(path)).toBe(true)
    expect(jsonOf(await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken }))).toEqual({
      sessionId: OWNER,
      cleaned: true,
    })
    expect(existsSync(path)).toBe(false)

    // Single use: a repeat is rejected as unknown, and a file that reappears is left alone.
    writeFileSync(path, 'again')
    const repeat = await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
    expect(repeat.isError).toBe(true)
    expect(textOf(repeat)).toContain('unknown, already used')
    expect(existsSync(path)).toBe(true)
  })

  it('mints a distinct token for every export', async () => {
    const { token } = exportAs(createSnapshotRegistry(), snapshotFile())
    expect(await token()).not.toBe(await token())
  })

  it('rejects another session token, leaves the file, and does not spend the real token', async () => {
    const path = snapshotFile()
    const { h, token } = exportAs(createSnapshotRegistry(), path)
    const cleanupToken = await token()
    const stolen = await h.call('snapshot_cleanup', { sessionId: 'native:other', cleanupToken })
    expect(stolen.isError).toBe(true)
    expect(textOf(stolen)).toContain('another session or worktree')
    expect(existsSync(path)).toBe(true)
    const owner = await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
    expect(owner.isError).toBeUndefined()
    expect(existsSync(path)).toBe(false)
  })

  it('rejects a token presented for another worktree and leaves the file', async () => {
    const path = snapshotFile()
    const { h, token } = exportAs(createSnapshotRegistry(), path)
    const cleanupToken = await token()
    const result = await h.call('snapshot_cleanup', {
      sessionId: OWNER,
      worktree: fixture().linked,
      cleanupToken,
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('another session or worktree')
    expect(existsSync(path)).toBe(true)
    expect((await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })).isError).toBe(
      undefined,
    )
  })

  it('rejects forged and unknown tokens, including a path used as a token', async () => {
    const path = snapshotFile()
    const { h } = exportAs(createSnapshotRegistry(), path)
    for (const cleanupToken of [path, 'forged', 'client-token']) {
      const result = await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
      expect(result.isError, cleanupToken).toBe(true)
      expect(textOf(result)).toContain('nothing was deleted')
      expect(existsSync(path)).toBe(true)
    }
  })

  it('forgets every token when the server restarts and leaves the file in place', async () => {
    const path = snapshotFile()
    const before = exportAs(createSnapshotRegistry(), path)
    const cleanupToken = await before.token()
    const restarted = exportAs(createSnapshotRegistry(), path)
    const result = await restarted.h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('unknown, already used')
    expect(existsSync(path)).toBe(true)
  })

  it('accepts no caller-chosen path, directory, or receipt', async () => {
    const path = snapshotFile()
    const { h, token } = exportAs(createSnapshotRegistry(), path)
    const cleanupToken = await token()
    for (const extra of ['path', 'directory', 'receipt', 'file']) {
      const result = await h.call('snapshot_cleanup', {
        sessionId: OWNER,
        cleanupToken,
        [extra]: path,
      })
      expect(textOf(result)).toContain(`unsupported argument(s): ${extra}`)
    }
    expect(existsSync(path)).toBe(true)
  })

  it('enforces the shared session and worktree validation and requires the token', async () => {
    const path = snapshotFile()
    const { h, token } = exportAs(createSnapshotRegistry(), path)
    const cleanupToken = await token()
    const badSession = await h.call('snapshot_cleanup', { sessionId: '../escape', cleanupToken })
    expect(textOf(badSession)).toContain('session id must be URL-safe')
    const badWorktree = await h.call('snapshot_cleanup', {
      sessionId: OWNER,
      worktree: '/definitely/not/a/worktree',
      cleanupToken,
    })
    expect(badWorktree.isError).toBe(true)
    const missing = await h.call('snapshot_cleanup', { sessionId: OWNER })
    expect(textOf(missing)).toContain('cleanupToken is required')
    expect(existsSync(path)).toBe(true)
  })

  it('keeps the token valid after a failed cleanup so the same call can retry', async () => {
    const path = snapshotFile()
    const { h, token } = exportAs(createSnapshotRegistry(), path)
    const cleanupToken = await token()
    rmSync(path)
    mkdirSync(path)
    const failed = await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
    expect(failed.isError).toBe(true)
    expect(textOf(failed)).toContain('still valid; retry the same call')
    expect(textOf(failed)).toContain('not a generated regular file')
    rmSync(path, { recursive: true })
    writeFileSync(path, '{}\n')
    expect((await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })).isError).toBe(
      undefined,
    )
    expect(existsSync(path)).toBe(false)
  })

  it('succeeds when the file is already gone', async () => {
    const path = snapshotFile()
    const { h, token } = exportAs(createSnapshotRegistry(), path)
    const cleanupToken = await token()
    rmSync(path)
    expect(
      jsonOf(await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })).cleaned,
    ).toBe(true)
  })
})
