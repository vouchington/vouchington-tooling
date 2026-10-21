import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(packageRoot, 'scripts/run-bounded.py')
const fixtures = join(packageRoot, 'scripts/run-bounded-fixtures')

describe('run-bounded merged output ordering', () => {
  it.each(['pipe', 'socket', 'regular', 'independent-files', 'terminal'])(
    'preserves sequential writes and open descriptions for %s',
    (mode) => {
      const result = spawnSync(
        'python3',
        [join(fixtures, 'run-bounded-merged-output.py'), script, mode],
        {
          encoding: 'utf8',
          timeout: 7000,
        },
      )
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(JSON.parse(result.stdout)).toEqual({
        status: 3,
        length: 1048577,
        marker: 1048576,
        allBytes: true,
        positions: mode === 'independent-files' ? [1048576, 1048577] : null,
      })
    },
  )
})
