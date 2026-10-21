import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { storyCoverageConfig } from './options.mts'
import { workspaceFiles } from './workspace.mts'

describe('workspaceFiles', () => {
  let root: string | undefined

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it('lists nested source files and skips missing directories and other files', async () => {
    root = await mkdtemp(join(tmpdir(), 'story-workspace-'))
    await mkdir(join(root, 'ui/components/nested'), { recursive: true })
    await writeFile(join(root, 'ui/components/a.tsx'), 'export const A = 1\n')
    await writeFile(join(root, 'ui/components/nested/b.ts'), 'export const B = 1\n')
    await writeFile(join(root, 'ui/components/notes.md'), '# notes\n')
    const config = storyCoverageConfig({
      root,
      componentRoot: 'ui/components',
      storyRoot: 'ui/stories',
      sourceExtensions: ['.tsx', '.ts'],
      componentExtensions: ['.tsx'],
      marker: /marker/,
      storyFilePattern: /\.stories\.tsx$/,
    })
    expect(workspaceFiles(config)).toEqual(['ui/components/a.tsx', 'ui/components/nested/b.ts'])
  })

  it('returns nothing when neither directory exists', async () => {
    root = await mkdtemp(join(tmpdir(), 'story-workspace-empty-'))
    const config = storyCoverageConfig({
      root,
      componentRoot: 'ui/components',
      storyRoot: 'ui/stories',
      sourceExtensions: ['.ts'],
      componentExtensions: ['.tsx'],
      marker: /marker/,
      storyFilePattern: /\.stories\.tsx$/,
    })
    expect(workspaceFiles(config)).toEqual([])
  })
})
