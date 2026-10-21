import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TypeScriptModuleExport, TypeScriptModuleFacts } from 'no-mistakes'
import { afterEach, describe, expect, it } from 'vitest'
import { componentExports } from './components.mts'
import { storyCoverageConfig } from './options.mts'

describe('componentExports', () => {
  let root: string | undefined

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it('keeps PascalCase and default exports that match the marker', async () => {
    root = await mkdtemp(join(tmpdir(), 'story-components-'))
    await mkdir(join(root, 'ui/components'), { recursive: true })
    await writeFile(join(root, 'ui/components/example.tsx'), 'data-marker\n')
    await writeFile(join(root, 'ui/components/second.tsx'), 'data-marker\n')
    await writeFile(join(root, 'ui/components/plain.tsx'), 'export const Plain = 1\n')
    const config = storyCoverageConfig({
      root,
      componentRoot: 'ui/components',
      storyRoot: 'ui/stories',
      sourceExtensions: ['.tsx', '.ts'],
      componentExtensions: ['.tsx'],
      marker: /data-marker/g,
      storyFilePattern: /\.stories\.tsx$/,
    })
    const modules = new Map<string, TypeScriptModuleFacts>([
      [
        'ui/components/example.tsx',
        facts('ui/components/example.tsx', [
          exportItem({ exported: 'Card', specifier: './other' }),
          exportItem({ exported: 'Props', typeOnly: true }),
          exportItem({ exported: 'default', local: 'lowerCase' }),
          exportItem({ exported: 'default', local: '' }),
          exportItem({ exported: 'Named' }),
          exportItem({ exported: 'notAComponent' }),
        ]),
      ],
      [
        'ui/components/second.tsx',
        facts('ui/components/second.tsx', [exportItem({ exported: 'Second' })]),
      ],
    ])
    expect(
      componentExports(
        [
          'ui/stories/example.stories.tsx',
          'ui/components/barrel.ts',
          'ui/components/__tests__/hidden.tsx',
          'ui/components/widget.test.tsx',
          'ui/components/plain.tsx',
          'ui/components/example.tsx',
          'ui/components/second.tsx',
        ],
        modules,
        config,
      ).map((component) => `${component.key} ${component.displayName}`),
    ).toEqual([
      'ui/components/example.tsx#default lowerCase',
      'ui/components/example.tsx#default default',
      'ui/components/example.tsx#Named Named',
      'ui/components/second.tsx#Second Second',
    ])
  })

  it('rejects missing and incomplete component facts', async () => {
    root = await mkdtemp(join(tmpdir(), 'story-components-bad-'))
    await mkdir(join(root, 'ui/components'), { recursive: true })
    await writeFile(join(root, 'ui/components/missing.tsx'), 'data-marker\n')
    const config = storyCoverageConfig({
      root,
      componentRoot: 'ui/components',
      storyRoot: 'ui/stories',
      sourceExtensions: ['.tsx'],
      componentExtensions: ['.tsx'],
      marker: /data-marker/,
      storyFilePattern: /\.stories\.tsx$/,
    })
    const file = 'ui/components/missing.tsx'
    expect(() => componentExports([file], new Map(), config)).toThrow(
      'Incomplete component module facts',
    )
    expect(() =>
      componentExports([file], new Map([[file, facts(file, [], false)]]), config),
    ).toThrow('Incomplete component module facts')
  })
})

function exportItem(
  overrides: Partial<TypeScriptModuleExport> & { exported: string },
): TypeScriptModuleExport {
  return {
    specifier: null,
    local: overrides.exported,
    typeOnly: false,
    span: { start: 0, end: 0 },
    ...overrides,
  }
}

function facts(
  file: string,
  exports: TypeScriptModuleExport[],
  complete = true,
): TypeScriptModuleFacts {
  return {
    fileName: file,
    complete,
    imports: [],
    exports,
    bindings: [],
    scopes: [],
    loads: [],
    diagnostics: [],
  }
}
