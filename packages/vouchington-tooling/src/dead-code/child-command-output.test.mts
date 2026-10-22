import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { runChildCommand } from './child-command.mts'

describe('child command output bound', () => {
  it('kills a command whose output exceeds the buffer limit', async () => {
    await expect(
      runChildCommand(
        process.execPath,
        ['-e', "process.stdout.write('x'.repeat(9 * 1024 * 1024)); setInterval(() => {}, 1000)"],
        tmpdir(),
      ),
    ).rejects.toThrow('maxBuffer')
  })
})
