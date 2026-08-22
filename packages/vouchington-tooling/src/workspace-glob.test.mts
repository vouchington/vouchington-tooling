import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { expandWorkspaceGlob } from './workspace-glob.mts'

describe('expandWorkspaceGlob', () => {
  const testDirs: string[] = []

  afterEach(() => {
    for (const dir of testDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  })

  function makeRoot(): string {
    const root = mkdtempSync(path.join(tmpdir(), 'workspace-glob-'))
    testDirs.push(root)
    mkdirSync(path.join(root, 'services', 'api'), { recursive: true })
    mkdirSync(path.join(root, 'libs', 'one', 'pkg'), { recursive: true })
    mkdirSync(path.join(root, 'blocked-dir'), { recursive: true })
    writeFileSync(path.join(root, 'blocked'), 'file\n')
    writeFileSync(path.join(root, 'services', 'README'), 'file\n')
    return root
  }

  it('resolves literal paths, single-segment globs, and nested globs', () => {
    const root = makeRoot()
    expect(expandWorkspaceGlob(root, 'apps/api')).toEqual([path.join(root, 'apps', 'api')])
    expect(expandWorkspaceGlob(root, 'services/*').toSorted()).toEqual([
      path.join(root, 'services', 'api'),
    ])
    expect(expandWorkspaceGlob(root, 'libs/*/pkg')).toEqual([path.join(root, 'libs', 'one', 'pkg')])
    expect(expandWorkspaceGlob(root, 'blocked*')).toEqual([path.join(root, 'blocked-dir')])
    expect(expandWorkspaceGlob(root, 'missing/*')).toEqual([])
    expect(expandWorkspaceGlob(root, '*x*')).toEqual([])
  })
})
