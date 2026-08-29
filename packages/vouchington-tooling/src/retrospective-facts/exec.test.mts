import { describe, expect, it } from 'vitest'
import { rawBlock, shell } from './exec.mts'

describe('retrospective command execution', () => {
  it('captures successful and failed child process output', async () => {
    await expect(
      shell(process.execPath, ['-e', "process.stdout.write('out');process.stderr.write('err')"]),
    ).resolves.toEqual({
      ok: true,
      stdout: 'out',
      stderr: 'err',
    })
    const failure = await shell(process.execPath, [
      '-e',
      "process.stderr.write('bad');process.exit(3)",
    ])
    expect(failure).toEqual({ ok: false, stdout: '', stderr: 'bad' })
    await expect(shell('/definitely/missing-vouchington-command', [])).resolves.toMatchObject({
      ok: false,
      stdout: '',
      stderr: expect.stringContaining('ENOENT'),
    })
  })

  it('formats raw blocks with optional stderr separation', () => {
    expect(rawBlock('git', ['status'], { ok: true, stdout: 'clean', stderr: '' })).toBe(
      '$ git status\nclean\n\n',
    )
    expect(rawBlock('git', [], { ok: false, stdout: '', stderr: 'bad' })).toBe(
      '$ git \nstderr:\nbad\n\n',
    )
  })
})
