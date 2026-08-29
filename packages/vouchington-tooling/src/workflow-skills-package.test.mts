import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginRoots = ['vouchington-workflow', 'vouchington-testing', 'vouchington-database'].map(
  (plugin) => resolve(packageRoot, '../../plugins', plugin, 'skills'),
)

describe('workflow skills package contract', () => {
  it('ships exactly the canonical skills at stable paths without tracked copies', () => {
    const output = mkdtempSync(resolve(tmpdir(), 'vouchington-skills-pack-'))
    try {
      execFileSync('pnpm', ['pack', '--pack-destination', output], { cwd: packageRoot })
      const tarball = join(
        output,
        readdirSync(output).find((name) => name.endsWith('.tgz'))!,
      )
      const packaged = tarPaths(gunzipSync(readFileSync(tarball)))
        .filter((path) => path.startsWith('package/skills/') && path.endsWith('/SKILL.md'))
        .sort()
      const canonical = pluginRoots
        .flatMap((root) => skillPaths(root))
        .map((path) => `package/skills/${path}`)
        .sort()
      expect(packaged).toHaveLength(25)
      expect(packaged).toEqual(canonical)
      expect(
        execFileSync('git', ['ls-files', 'skills'], { cwd: packageRoot, encoding: 'utf8' }),
      ).toBe('')
    } finally {
      rmSync(output, { force: true, recursive: true })
    }
  })
})

function skillPaths(root: string, path = root): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    if (entry.isDirectory()) return skillPaths(root, child)
    return entry.name === 'SKILL.md' ? [relative(root, child).replaceAll('\\', '/')] : []
  })
}

function tarPaths(archive: Buffer): string[] {
  const paths: string[] = []
  for (let offset = 0; offset < archive.length;) {
    const name = archive
      .subarray(offset, offset + 100)
      .toString()
      .replace(/\0.*$/, '')
    if (!name) break
    const prefix = archive
      .subarray(offset + 345, offset + 500)
      .toString()
      .replace(/\0.*$/, '')
    const size = Number.parseInt(archive.subarray(offset + 124, offset + 136).toString(), 8)
    paths.push(prefix ? `${prefix}/${name}` : name)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return paths
}
