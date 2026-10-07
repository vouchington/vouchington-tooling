import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzeTypeScriptModules } from 'no-mistakes'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createSourceModuleGraph,
  type SourceExportOwner,
  type SourceModuleGraph,
  type SourceModuleGraphOptions,
} from '../source-module-graph/index.mts'

describe('source module graph', () => {
  let root: string
  let facts: Awaited<ReturnType<typeof analyzeTypeScriptModules>>
  const files = [
    'web/storybook/button.stories.tsx',
    'web/components/barrel.ts',
    'web/components/button.tsx',
    'web/components/lazy.ts',
    'web/components/types.ts',
    'web/components/unused.ts',
    'web/components/folder/index.ts',
    'web/components/other.ts',
    'web/components/ambiguous.ts',
    'web/components/uncertain.ts',
    'web/components/dep.ts',
    'web/components/dep.mts',
    'web/components/dep.cts',
  ]

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'source-module-graph-'))
    const sources: Record<string, string> = {
      'web/storybook/button.stories.tsx': `
        import { Card, type SomeType } from '@/components/barrel'
        import { Unused } from '@/components/unused'
        import type { Props } from '@/components/types'
        import '@/components/lazy'
        function shadow(Unused: string) { return Unused }
        export const story = Card
        void import('@/components/lazy')
        void require('@/components/lazy')
      `,
      'web/components/barrel.ts': `
        import { Button as Renamed } from './button'
        import * as ImportedNamespace from './button'
        import { Missing as ImportedMissing } from './missing'
        export { Renamed as Imported }
        export { ImportedNamespace }
        export { ImportedMissing }
        export { Button as Card } from './button'
        export { Ghost } from './missing'
        export * as Namespace from './button'
        export * from './button'
        export type SomeType = string
      `,
      'web/components/button.tsx': `
        export function Button() { return null }
        export default function DefaultButton() { return null }
        export * from './barrel'
      `,
      'web/components/lazy.ts': `export const Lazy = true`,
      'web/components/types.ts': `export type Props = { title: string }`,
      'web/components/unused.ts': `export const Unused = true`,
      'web/components/folder/index.ts': `export const Nested = true`,
      'web/components/other.ts': `export const Button = 2`,
      'web/components/ambiguous.ts': `
        export * from './button'
        export * from './other'
      `,
      'web/components/uncertain.ts': `
        export * from './button'
        export * from 'external-package'
      `,
      'web/components/dep.ts': `export const Dep = 1`,
      'web/components/dep.mts': `export const DepM = 1`,
      'web/components/dep.cts': `export const DepC = 1`,
    }
    for (const [file, source] of Object.entries(sources)) {
      const target = join(root, file)
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, source)
    }
    facts = await analyzeTypeScriptModules({ root, files })
    expect(facts.modules.every((module) => module.complete)).toBe(true)
  })

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  function graph(overrides: Partial<SourceModuleGraphOptions> = {}): SourceModuleGraph {
    return createSourceModuleGraph({
      root,
      extensions: ['.tsx', '.ts', '.mts', '.cts'],
      aliases: { '@/': 'web/', '@/components/': 'web/components/' },
      files,
      facts,
      ...overrides,
    })
  }

  it('uses binding references for runtime imports, excluding type-only and shadowed names', () => {
    const imports = graph().runtimeImports(files[0] ?? '')
    expect(imports.map((item) => item.specifier)).toEqual([
      '@/components/barrel',
      '@/components/lazy',
    ])
    expect(imports[0]?.bindings.map((binding) => binding.local)).toEqual(['Card'])
    const imported = facts.modules
      .find((module) => module.fileName.endsWith(files[0] ?? ''))
      ?.imports.flatMap((entry) => entry.bindings)
    expect(imported?.map((binding) => binding.local)).toEqual([
      'Card',
      'SomeType',
      'Unused',
      'Props',
    ])
  })

  it('resolves aliases and follows runtime reexports and literal dynamic loads across a cycle', () => {
    const sourceGraph = graph()
    expect(sourceGraph.resolveSource(files[0] ?? '', '@/components/barrel')).toBe(
      'web/components/barrel.ts',
    )
    expect(sourceGraph.resolveSource(files[0] ?? '', '@/components/folder')).toBe(
      'web/components/folder/index.ts',
    )
    expect(sourceGraph.resolveSource(files[0] ?? '', '@/components/lazy.ts')).toBe(
      'web/components/lazy.ts',
    )
    expect(
      facts.modules
        .find((module) => module.fileName.endsWith(files[0] ?? ''))
        ?.loads.map((load) => load.kind),
    ).toEqual(['dynamicImport', 'require'])
    expect(sourceGraph.reachableFrom([files[0] ?? ''], { runtimeOnly: true })).toEqual([
      'web/components/barrel.ts',
      'web/components/button.tsx',
      'web/components/lazy.ts',
      'web/storybook/button.stories.tsx',
    ])
    expect(sourceGraph.reachableFrom([files[0] ?? ''])).toContain('web/components/types.ts')
  })

  it('resolves renamed and star reexports to their original owner', () => {
    const sourceGraph = graph()
    const cardOwner: SourceExportOwner = {
      file: 'web/components/button.tsx',
      exportName: 'Button',
    }
    expect(sourceGraph.resolveExportOwner('web/components/barrel.ts', 'Card')).toEqual(cardOwner)
    expect(sourceGraph.resolveExportOwner('web/components/barrel.ts', 'Imported')).toEqual({
      file: 'web/components/button.tsx',
      exportName: 'Button',
    })
    expect(sourceGraph.resolveExportOwner('web/components/barrel.ts', 'Namespace')).toEqual({
      file: 'web/components/button.tsx',
      exportName: '*',
    })
    expect(sourceGraph.resolveExportOwner('web/components/barrel.ts', 'ImportedNamespace')).toEqual(
      {
        file: 'web/components/button.tsx',
        exportName: '*',
      },
    )
    expect(sourceGraph.resolveExportOwner('web/components/barrel.ts', 'Button')).toEqual({
      file: 'web/components/button.tsx',
      exportName: 'Button',
    })
    expect(sourceGraph.resolveExportOwner('web/components/button.tsx', 'default')).toEqual({
      file: 'web/components/button.tsx',
      exportName: 'default',
    })
    expect(sourceGraph.resolveExportOwner('web/components/barrel.ts', 'default')).toBeNull()
    expect(sourceGraph.resolveExportOwner('web/components/barrel.ts', 'Missing')).toBeNull()
    expect(sourceGraph.resolveExportOwner('web/components/barrel.ts', 'Ghost')).toBeNull()
    expect(sourceGraph.resolveExportOwner('web/components/barrel.ts', 'ImportedMissing')).toBeNull()
    expect(sourceGraph.resolveExportOwner('web/components/ambiguous.ts', 'Button')).toBeNull()
    expect(sourceGraph.resolveExportOwner('web/components/uncertain.ts', 'Button')).toBeNull()
    expect(sourceGraph.resolveExportOwner('../outside.ts', 'Button')).toBeNull()
  })

  it('fails closed on incomplete facts and bounds the supplied inventory', () => {
    const incomplete = {
      modules: facts.modules.map((module) =>
        module.fileName.endsWith(files[0] ?? '') ? { ...module, complete: false } : module,
      ),
    }
    expect(() => graph({ facts: incomplete }).reachableFrom([files[0] ?? ''])).toThrow(
      'Incomplete source module facts',
    )
    expect(() => graph({ maxFiles: files.length - 1 })).toThrow('Source graph file limit exceeded')
    expect(() => graph({ files: ['../outside.ts'] })).toThrow('Source graph file escapes root')
    expect(() => graph({ facts: { modules: [facts.modules[0]!, facts.modules[0]!] } })).toThrow(
      'Unexpected source module facts',
    )
    expect(() => graph({ facts: { modules: [] } }).reachableFrom([files[0] ?? ''])).toThrow(
      'Incomplete source module facts',
    )
    expect(() => graph().runtimeImports('../outside.ts')).toThrow('Incomplete source module facts')
    const brokenBinding = {
      modules: facts.modules.map((module) =>
        module.fileName.endsWith(files[0] ?? '')
          ? {
              ...module,
              imports: module.imports.map((entry, index) =>
                index === 0
                  ? {
                      ...entry,
                      bindings: entry.bindings.map((binding) => ({ ...binding, bindingId: -1 })),
                    }
                  : entry,
              ),
            }
          : module,
      ),
    }
    expect(() => graph({ facts: brokenBinding }).runtimeImports(files[0] ?? '')).toThrow(
      'Missing import binding facts',
    )
    const missingTarget = {
      modules: facts.modules.filter((module) => !module.fileName.endsWith('button.tsx')),
    }
    expect(() =>
      graph({ facts: missingTarget }).resolveExportOwner('web/components/barrel.ts', 'Namespace'),
    ).toThrow('Incomplete source module facts')
    expect(() =>
      graph({ facts: missingTarget }).resolveExportOwner(
        'web/components/barrel.ts',
        'ImportedNamespace',
      ),
    ).toThrow('Incomplete source module facts')
  })

  it('rejects unresolved, external, and escaping specifiers', () => {
    const sourceGraph = graph()
    expect(sourceGraph.resolveSource(files[0] ?? '', 'external-package')).toBeNull()
    expect(sourceGraph.resolveSource('missing.ts', './button')).toBeNull()
    expect(sourceGraph.resolveSource(files[0] ?? '', '@/components/absent')).toBeNull()
    expect(sourceGraph.resolveSource(files[0] ?? '', '../../../../outside')).toBeNull()
    expect(sourceGraph.resolveSource('web/components/barrel.ts', './dep.js')).toBe(
      'web/components/dep.ts',
    )
    expect(sourceGraph.resolveSource('web/components/barrel.ts', './dep.mjs')).toBe(
      'web/components/dep.mts',
    )
    expect(sourceGraph.resolveSource('web/components/barrel.ts', './dep.cjs')).toBe(
      'web/components/dep.cts',
    )
    expect(sourceGraph.resolveSource('web\\components\\barrel.ts', './button')).toBe(
      'web/components/button.tsx',
    )
    expect(sourceGraph.resolveSource(join(root, 'web/components/barrel.ts'), './button')).toBe(
      'web/components/button.tsx',
    )
    expect(
      graph({ files: files.map((file) => join(root, file)) }).runtimeImports(join(root, files[0]!))
        .length,
    ).toBe(2)
    expect(
      graph({ aliases: { '@escape/': '../outside/' } }).resolveSource(
        files[0] ?? '',
        '@escape/file',
      ),
    ).toBeNull()
    expect(
      createSourceModuleGraph({ root, extensions: ['.tsx', '.ts'], files, facts }).resolveSource(
        'web/components/barrel.ts',
        './button',
      ),
    ).toBe('web/components/button.tsx')
  })
})
