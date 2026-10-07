import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzeTypeScriptModules } from 'no-mistakes'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSourceModuleGraph } from './source-graph.mts'

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
  ]

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'source-module-graph-'))
    const sources: Record<string, string> = {
      'web/storybook/button.stories.tsx': `
        import { Card } from '@/components/barrel'
        import { Unused } from '@/components/unused'
        import type { Props } from '@/components/types'
        function shadow(Unused: string) { return Unused }
        export const story = Card
        void import('@/components/lazy')
        void require('@/components/lazy')
      `,
      'web/components/barrel.ts': `
        export { Button as Card } from './button'
        export * from './button'
      `,
      'web/components/button.tsx': `
        export function Button() { return null }
        export default function DefaultButton() { return null }
        export * from './barrel'
      `,
      'web/components/lazy.ts': `export const Lazy = true`,
      'web/components/types.ts': `export type Props = { title: string }`,
      'web/components/unused.ts': `export const Unused = true`,
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

  function graph(overrides: Partial<Parameters<typeof createSourceModuleGraph>[0]> = {}) {
    return createSourceModuleGraph({
      root,
      extensions: ['.tsx', '.ts'],
      aliases: { '@/': 'web/' },
      files,
      facts,
      ...overrides,
    })
  }

  it('uses binding references for runtime imports, excluding type-only and shadowed names', () => {
    const imports = graph().runtimeImports(files[0] ?? '')
    expect(imports.map((item) => item.specifier)).toEqual(['@/components/barrel'])
    expect(imports[0]?.bindings.map((binding) => binding.local)).toEqual(['Card'])
    const imported = facts.modules
      .find((module) => module.fileName.endsWith(files[0] ?? ''))
      ?.imports.flatMap((entry) => entry.bindings)
    expect(imported?.map((binding) => binding.local)).toEqual(['Card', 'Unused', 'Props'])
  })

  it('resolves aliases and follows runtime reexports and literal dynamic loads across a cycle', () => {
    const sourceGraph = graph()
    expect(sourceGraph.resolveSource(files[0] ?? '', '@/components/barrel')).toBe(
      'web/components/barrel.ts',
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
    expect(sourceGraph.resolveExportOwner('web/components/barrel.ts', 'Card')).toEqual({
      file: 'web/components/button.tsx',
      exportName: 'Button',
    })
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
    expect(() => graph({ maxFiles: 5 })).toThrow('Source graph file limit exceeded')
  })
})
