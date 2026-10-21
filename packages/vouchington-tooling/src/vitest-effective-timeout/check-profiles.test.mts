import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkFiniteTimeoutProfiles, openVitestTimeoutRun } from './check-profiles.mts'
import { timeoutProfiles } from './profiles.mts'
import {
  effectiveTimeoutGuardHref,
  runTimeoutProfile,
  type OpenTimeoutRun,
} from './run-profile.mts'

const open: OpenTimeoutRun = async ({ root }) => ({
  async start() {
    const name = root.split('/').at(-1)
    const profile = timeoutProfiles(30_000).find((item) => item.name === name)
    if (!profile?.admitted) {
      throw new Error(`Project ${name}: effective testTimeout must be finite; received 30001`)
    }
    await writeFile(join(root, 'body.marker'), 'ran')
    await writeFile(join(root, 'setup-import.marker'), 'imported')
    await writeFile(join(root, 'setup-call.marker'), 'called')
    return { testModules: [{ ok: () => true }], unhandledErrors: [] }
  },
  async close() {},
})

describe('checkFiniteTimeoutProfiles', () => {
  it('admits the parameterized profiles through an injected runner', async () => {
    const scratchDir = await mkdtemp(join(tmpdir(), 'effective-timeout-'))
    try {
      const rows = await checkFiniteTimeoutProfiles(scratchDir, { scratchDir, open })
      expect(rows.map((row) => row.profile)).toEqual(
        timeoutProfiles(30_000).map((profile) => profile.name),
      )
      expect(
        rows.every(
          (row) =>
            row.rejected ===
            !timeoutProfiles(30_000).find((profile) => profile.name === row.profile)?.admitted,
        ),
      ).toBe(true)
    } finally {
      await rm(scratchDir, { recursive: true, force: true })
    }
  })

  it('drops the mid-cap profile when the cap is below 15000ms', async () => {
    const scratchDir = await mkdtemp(join(tmpdir(), 'effective-timeout-small-'))
    try {
      const rows = await checkFiniteTimeoutProfiles(scratchDir, {
        maxTimeoutMs: 10_000,
        scratchDir,
        open,
      })
      expect(rows.map((row) => row.profile)).not.toContain('bounded-fifteen')
    } finally {
      await rm(scratchDir, { recursive: true, force: true })
    }
  })

  it('writes the caller plugin name into the generated config and aggregates a close failure', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'effective-timeout-one-'))
    const profile = timeoutProfiles(30_000)[0]
    if (!profile) throw new Error('missing profile')
    try {
      await runTimeoutProfile(profile, {
        scratch,
        maxTimeoutMs: 30_000,
        pluginName: 'caller-timeout-cap',
        open,
      })
      expect(await readFile(join(scratch, profile.name, 'vitest.config.mts'), 'utf8')).toContain(
        'caller-timeout-cap',
      )
      const failing: OpenTimeoutRun = async () => ({
        async start() {
          return { testModules: [{ ok: () => true }], unhandledErrors: [] }
        },
        async close() {
          throw new Error('close failed')
        },
      })
      await expect(
        runTimeoutProfile(profile, {
          scratch,
          maxTimeoutMs: 30_000,
          pluginName: 'caller-timeout-cap',
          open: failing,
        }),
      ).rejects.toThrow(/Profile context close failed/)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  })

  it('uses the default scratch directory and reports a failed admission', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'effective-timeout-root-'))
    const failing: OpenTimeoutRun = async ({ root }) => ({
      async start() {
        await rm(root, { recursive: true, force: true })
        await writeFile(root, 'not-a-directory')
        return { testModules: [{ ok: () => true }], unhandledErrors: [] }
      },
      async close() {},
    })
    try {
      await expect(checkFiniteTimeoutProfiles(repoRoot, { open: failing })).rejects.toThrow()
      expect(effectiveTimeoutGuardHref('file:///pkg/run-profile.mjs')).toMatch(/cap\.mjs$/)
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  it('aggregates a scratch cleanup failure after a successful and a failed admission', async () => {
    const scratchDir = await mkdtemp(join(tmpdir(), 'effective-timeout-cleanup-'))
    try {
      await expect(
        checkFiniteTimeoutProfiles(scratchDir, {
          scratchDir,
          open,
          removeScratch: async () => {
            throw new Error('cleanup failed')
          },
        }),
      ).rejects.toThrow(/Finite timeout admission failed/)
      const failing: OpenTimeoutRun = async () => {
        throw new Error('Project sample: effective testTimeout must be finite')
      }
      await expect(
        checkFiniteTimeoutProfiles(scratchDir, {
          scratchDir,
          open: failing,
          removeScratch: async () => {
            throw new Error('cleanup failed')
          },
        }),
      ).rejects.toThrow(/Finite timeout admission failed/)
    } finally {
      await rm(scratchDir, { recursive: true, force: true })
    }
  })

  it('keeps both the run rejection and the close error', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'effective-timeout-both-'))
    const profile = timeoutProfiles(30_000).find((item) => !item.admitted)
    if (!profile) throw new Error('missing rejected profile')
    const failing: OpenTimeoutRun = async () => ({
      async start() {
        throw new Error('Project sample: effective hookTimeout must be finite')
      },
      async close() {
        throw new Error('close failed')
      },
    })
    try {
      await expect(
        runTimeoutProfile(profile, {
          scratch,
          maxTimeoutMs: 30_000,
          pluginName: 'caller-timeout-cap',
          open: failing,
        }),
      ).rejects.toThrow(/Profile context close failed/)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  })

  it('runs every admission profile through Vitest when no runner is injected', async () => {
    const scratchDir = await mkdtemp(join(process.cwd(), 'node_modules', '.effective-timeout-all-'))
    try {
      const rows = await checkFiniteTimeoutProfiles(process.cwd(), { scratchDir })
      expect(rows).toHaveLength(timeoutProfiles(30_000).length)
    } finally {
      await rm(scratchDir, { recursive: true, force: true })
    }
  }, 120_000)

  it('rejects an oversized project and runs a bounded one through Vitest', async () => {
    const scratchDir = await mkdtemp(join(process.cwd(), 'node_modules', '.effective-timeout-'))
    await mkdir(scratchDir, { recursive: true })
    try {
      const rows = await checkFiniteTimeoutProfiles(process.cwd(), {
        scratchDir,
        pluginName: 'effective-test-timeout-cap',
        open: async (input) => {
          const selected =
            input.root.endsWith('/bounded-five') || input.root.endsWith('/oversized-cli')
          if (!selected) return open(input)
          return openVitestTimeoutRun(input)
        },
      })
      expect(rows.find((row) => row.profile === 'bounded-five')?.rejected).toBe(false)
      expect(rows.find((row) => row.profile === 'oversized-cli')?.rejected).toBe(true)
    } finally {
      await rm(scratchDir, { recursive: true, force: true })
    }
  }, 60_000)
})
