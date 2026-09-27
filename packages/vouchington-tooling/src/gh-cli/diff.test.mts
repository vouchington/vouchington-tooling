import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'

import { DiffCommandError, processDiffCommand } from './diff.mts'

function git(directory: string, args: string[]): void {
  execFileSync('git', args, { cwd: directory, stdio: 'ignore' })
}

describe('processDiffCommand', () => {
  it('streams a real git diff larger than one MiB as one file block', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diff stream large-'))
    try {
      git(directory, ['init', '--quiet'])
      git(directory, ['config', 'user.email', 'test@example.invalid'])
      git(directory, ['config', 'user.name', 'Test User'])
      await writeFile(join(directory, 'large.txt'), 'base\n')
      git(directory, ['add', 'large.txt'])
      git(directory, ['commit', '--quiet', '-m', 'base'])
      await writeFile(join(directory, 'large.txt'), `${'x'.repeat(1_100_000)}\n`)
      const blocks: string[] = []
      await processDiffCommand(
        { executable: 'git', args: ['diff', '--no-ext-diff', 'HEAD'], cwd: directory },
        (block) => {
          blocks.push(block)
        },
      )
      expect(blocks).toHaveLength(1)
      expect(Buffer.byteLength(blocks[0]!)).toBeGreaterThan(1_048_576)
      expect(blocks[0]).toContain('diff --git a/large.txt b/large.txt\n')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('keeps preambles, Unicode, CRLF lines, and no-newline markers intact across stdout chunks', async () => {
    const blocks: string[] = []
    const payload = 'notice\r\ndiff --git a/x b/x\r\n+€\r\n\\ No newline at end of file'
    await processDiffCommand(
      {
        executable: process.execPath,
        args: [
          '-e',
          `const value=Buffer.from(${JSON.stringify(payload)});const split=value.indexOf(Buffer.from('€'))+1;process.stdout.write(value.subarray(0,split));setTimeout(() => process.stdout.write(value.subarray(split)), 1)`,
        ],
      },
      (block) => {
        blocks.push(block)
      },
    )
    expect(blocks).toEqual([payload])
  })

  it('awaits each async callback before delivering the next file block', async () => {
    let releaseFirst!: () => void
    let firstDelivered!: () => void
    const firstBlock = new Promise<void>((resolve) => {
      firstDelivered = resolve
    })
    const blocks: string[] = []
    const running = processDiffCommand(
      {
        executable: process.execPath,
        args: [
          '-e',
          "process.stdout.write('diff --git a/a b/a\\n+a\\ndiff --git a/b b/b\\n+b\\n')",
        ],
      },
      async (block) => {
        blocks.push(block)
        if (blocks.length !== 1) return
        firstDelivered()
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      },
    )
    await firstBlock
    expect(blocks).toEqual(['diff --git a/a b/a\n+a\n'])
    releaseFirst()
    await running
    expect(blocks).toEqual(['diff --git a/a b/a\n+a\n', 'diff --git a/b b/b\n+b\n'])
  })

  it('reports a nonzero command after delivering its complete valid patch', async () => {
    const blocks: string[] = []
    const failure = await processDiffCommand(
      {
        executable: process.execPath,
        args: [
          '-e',
          "process.stdout.write('diff --git a/x b/x\\n');process.stderr.write('diagnostic');process.exit(3)",
        ],
      },
      (block) => {
        blocks.push(block)
      },
    ).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DiffCommandError)
    expect(failure).toMatchObject({ details: { code: 3, stderr: 'diagnostic' } })
    expect(failure).toHaveProperty('message', expect.stringMatching(/exited with 3.*diagnostic/i))
    expect(blocks).toEqual(['diff --git a/x b/x\n'])
  })

  it('drains oversized stderr and retains only its bounded diagnostic tail', async () => {
    const failure = await processDiffCommand(
      {
        executable: process.execPath,
        args: [
          '-e',
          "process.stderr.write('x'.repeat(1_100_000),()=>process.stderr.write(' final-diagnostic',()=>process.exit(4)))",
        ],
      },
      () => undefined,
    ).catch((error: unknown) => error)
    expect(failure).toMatchObject({ details: { code: 4 } })
    expect(failure).toHaveProperty('details.stderr', expect.stringContaining('final-diagnostic'))
    expect(Buffer.byteLength((failure as DiffCommandError).details.stderr)).toBeLessThanOrEqual(
      16 * 1024,
    )
  })

  it('reports a spawn failure', async () => {
    const failure = await processDiffCommand(
      { executable: 'missing-diff-command-for-test', args: [] },
      () => undefined,
    ).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DiffCommandError)
    expect(failure).toHaveProperty(
      'message',
      expect.stringMatching(/missing-diff-command-for-test/),
    )
  })

  it('reports a command terminated by a signal', async () => {
    const failure = await processDiffCommand(
      { executable: process.execPath, args: ['-e', "process.kill(process.pid, 'SIGTERM')"] },
      () => undefined,
    ).catch((error: unknown) => error)
    expect(failure).toMatchObject({ details: { code: null, signal: 'SIGTERM' } })
  })

  it('terminates the child when the callback rejects', async () => {
    const started = performance.now()
    const callbackFailure = new Error('callback failed')
    await expect(
      processDiffCommand(
        {
          executable: process.execPath,
          args: [
            '-e',
            "process.on('SIGTERM', () => undefined);process.stdout.write('diff --git a/x b/x\\ndiff --git a/y b/y\\n');setInterval(() => process.stdout.write('+more\\n'), 10_000)",
          ],
        },
        async () => Promise.reject(callbackFailure),
      ),
    ).rejects.toBe(callbackFailure)
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  it('preserves a final-block callback error', async () => {
    const callbackFailure = new Error('final callback failed')
    await expect(
      processDiffCommand(
        {
          executable: process.execPath,
          args: ['-e', "process.stdout.write('diff --git a/x b/x\\n')"],
        },
        () => {
          throw callbackFailure
        },
      ),
    ).rejects.toBe(callbackFailure)
  })

  it('accepts an empty diff and passes argv and a spaced cwd without a shell', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diff stream spaces '))
    try {
      await processDiffCommand(
        {
          executable: process.execPath,
          args: [
            '-e',
            "if (process.cwd().includes('diff stream spaces ') && process.argv[1] === ';not-a-shell-command') process.exit(0); process.exit(1)",
            ';not-a-shell-command',
          ],
          cwd: directory,
        },
        () => {
          throw new Error('empty output must not invoke the callback')
        },
      )
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
