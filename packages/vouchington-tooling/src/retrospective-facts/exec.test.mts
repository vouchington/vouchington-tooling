import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import { rawBlock, shell } from './exec.mts'

describe('retrospective command execution', () => {
  it('captures successful and failed child process output', async () => {
    await expect(
      shell(process.execPath, ['-e', "process.stdout.write('out');process.stderr.write('err')"]),
    ).resolves.toEqual({
      ok: true,
      stdout: 'out',
      stderr: 'err',
      exitCode: 0,
    })
    const failure = await shell(process.execPath, [
      '-e',
      "process.stderr.write('bad');process.exit(3)",
    ])
    expect(failure).toEqual({ ok: false, stdout: '', stderr: 'bad', exitCode: 3 })
    await expect(shell('/definitely/missing-vouchington-command', [])).resolves.toMatchObject({
      ok: false,
      stdout: '',
      stderr: expect.stringContaining('ENOENT'),
      exitCode: null,
    })
  })

  it('decodes multibyte output split across stream chunks', async () => {
    const result = await shell(process.execPath, [
      '-e',
      'process.stdout.write(Buffer.from([0xe2]));process.stderr.write(Buffer.from([0xc3]));setTimeout(()=>{process.stdout.write(Buffer.from([0x82,0xac]));process.stderr.write(Buffer.from([0xa9]));},1)',
    ])
    expect(result).toMatchObject({ ok: true, stdout: '€', stderr: 'é', exitCode: 0 })
  })

  it('spawns gh without CLICOLOR_FORCE and keeps other variables', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vouchington-gh-shell-'))
    try {
      writeFileSync(
        join(dir, 'gh'),
        '#!/bin/sh\nprintf "%s|%s" "${CLICOLOR_FORCE-unset}" "$VOUCHINGTON_PASSTHROUGH"\n',
      )
      chmodSync(join(dir, 'gh'), 0o755)
      vi.stubEnv('PATH', `${dir}${delimiter}${process.env.PATH ?? ''}`)
      vi.stubEnv('CLICOLOR_FORCE', '1')
      vi.stubEnv('VOUCHINGTON_PASSTHROUGH', 'kept')
      await expect(shell('gh', [])).resolves.toMatchObject({ ok: true, stdout: 'unset|kept' })
    } finally {
      vi.unstubAllEnvs()
      rmSync(dir, { recursive: true, force: true })
    }
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
