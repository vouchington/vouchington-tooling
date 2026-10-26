import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { loadRegistryFiles } from './load.mts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'registry-load-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

const paths = { syncpackConfig: 's.json', workspaceFile: 'w.yaml', pathFilters: 'f.yml' }

describe('loadRegistryFiles', () => {
  it('reads the three registry files', () => {
    const root = fixture({
      's.json': '{"source":["a"]}',
      'w.yaml': 'packages:\n  - p/*\n',
      'f.yml': 'tooling:\n  - a\n',
    })
    expect(loadRegistryFiles(root, paths)).toEqual({
      syncpackSource: ['a'],
      workspacePackages: ['p/*'],
      pathFilters: { tooling: ['a'] },
    })
  })

  it('defaults absent or empty sections', () => {
    const root = fixture({ 's.json': '{}', 'w.yaml': '', 'f.yml': '' })
    expect(loadRegistryFiles(root, paths)).toEqual({
      syncpackSource: [],
      workspacePackages: [],
      pathFilters: {},
    })
  })
})
