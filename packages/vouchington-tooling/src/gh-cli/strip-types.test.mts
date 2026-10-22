import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const barrel = fileURLToPath(new URL('./index.mts', import.meta.url))

describe('gh-cli barrel under strip-only Node', () => {
  it('imports without non-erasable TypeScript syntax', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `const m = await import(${JSON.stringify(barrel)}); console.log(typeof m.DiffCommandError)`,
      ],
      { encoding: 'utf8' },
    )
    expect(result.stderr).not.toContain('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('function')
  })
})
