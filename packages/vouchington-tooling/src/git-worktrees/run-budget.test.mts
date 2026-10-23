import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { run } from './run.mts'

it('never starts an expired read, while allowing a removal without a timeout to finish', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worktree-read-budget-'))
  const marker = join(dir, 'started')
  const args = ['-e', "require('node:fs').writeFileSync(process.argv[1], 'done')", marker]
  try {
    const runtime = { cwd: dir, env: process.env, deadline: 0 }
    expect(run(process.execPath, args, runtime)).toBeUndefined()
    expect(existsSync(marker)).toBe(false)
    expect(run(process.execPath, args, { ...runtime, timeout: 0 })).toBe('')
    expect(existsSync(marker)).toBe(true)
    expect(run(process.execPath, ['-p', "'complete'"], { cwd: dir, env: process.env })).toBe(
      'complete\n',
    )
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})
