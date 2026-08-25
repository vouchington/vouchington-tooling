import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const canonicalRoot = resolve(packageRoot, '../../plugins/vouchington-workflow/skills')

describe('workflow skills package contract', () => {
  it('ships exactly the canonical skills at stable paths without tracked copies', () => {
    const output = mkdtempSync(resolve(tmpdir(), 'vouchington-skills-pack-'))
    try {
      execFileSync('pnpm', ['pack', '--pack-destination', output], { cwd: packageRoot })
      const tarball = execFileSync('find', [output, '-name', '*.tgz', '-print', '-quit'], {
        encoding: 'utf8',
      }).trim()
      const packaged = execFileSync('tar', ['-tf', tarball], { encoding: 'utf8' })
        .split('\n')
        .filter((path) => path.startsWith('package/skills/') && path.endsWith('/SKILL.md'))
        .sort()
      const canonical = execFileSync('find', [canonicalRoot, '-name', 'SKILL.md'], {
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean)
        .map((path) => `package/skills/${path.slice(canonicalRoot.length + 1)}`)
        .sort()
      expect(packaged).toEqual(canonical)
      expect(
        execFileSync('git', ['ls-files', 'skills'], { cwd: packageRoot, encoding: 'utf8' }),
      ).toBe('')
    } finally {
      rmSync(output, { force: true, recursive: true })
    }
  })
})
