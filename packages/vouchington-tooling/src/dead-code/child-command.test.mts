import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ChildCommandCleanupError, runChildCommand } from './child-command.mts'
import { createFixtureDeadline } from './fixture-deadline.test-helpers.mts'

const descendant = `
  const { spawn } = require('node:child_process')
  const { writeFileSync } = require('node:fs')
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' })
  child.once('spawn', () => {
    writeFileSync(process.argv[1], String(child.pid))
    if (process.argv[2] === 'exit') process.exit(0)
  })
`

describe('bounded child command ownership', () => {
  it('joins descendant output pipes after the direct child exits naturally', async () => {
    const remaining = createFixtureDeadline()
    const root = await mkdtemp(join(tmpdir(), 'analysis-command-exit-'))
    try {
      const marker = join(root, 'started')
      await runChildCommand(process.execPath, ['-e', descendant, marker, 'exit'], root, remaining)
      expect(Number(await readFile(marker, 'utf8'))).toBeGreaterThan(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('terminates the owned wrapper and its pipe-holding descendant at the shared deadline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'analysis-command-deadline-'))
    try {
      const marker = join(root, 'started')
      await expect(
        runChildCommand(process.execPath, ['-e', descendant, marker, 'hold'], root, () => 3000),
      ).rejects.toThrow('fixture deadline')
      expect(Number(await readFile(marker, 'utf8'))).toBeGreaterThan(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retains a real command failure without converting it into deadline success', async () => {
    const remaining = createFixtureDeadline()
    await expect(
      runChildCommand(
        process.execPath,
        [
          '-e',
          `process.stderr.write('x'.repeat(131072) + 'terminal-stderr-marker', () => process.exit(7))`,
        ],
        tmpdir(),
        remaining,
      ),
    ).rejects.toMatchObject({ code: 7, message: expect.stringContaining('terminal-stderr-marker') })
  })

  it('reports failed signaling without claiming drain, then joins after real owned cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'analysis-command-signal-'))
    // eslint-disable-next-line no-restricted-properties -- retain the real OS cleanup operation before the signal-failure control
    const originalKill = process.kill.bind(process)
    const signalError = Object.assign(new Error('controlled OS signal refusal'), { code: 'EPERM' })
    let failure: ChildCommandCleanupError | undefined
    let completed: Error | null | undefined
    const signal = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw signalError
    })
    try {
      try {
        await runChildCommand(
          process.execPath,
          ['-e', 'setInterval(() => {}, 1000)'],
          root,
          () => 1000,
        )
      } catch (err) {
        if (!(err instanceof ChildCommandCleanupError)) throw err
        failure = err
      }
      expect(failure).toBeDefined()
      expect(failure?.errors).toContain(signalError)
      expect(failure?.processGroupId).toBeGreaterThan(0)
    } finally {
      signal.mockRestore()
      if (failure) {
        originalKill(-failure.processGroupId, 'SIGKILL')
        completed = await failure.completion
      }
      await rm(root, { recursive: true, force: true })
    }
    expect(completed).toBeInstanceOf(Error)
  })
})
