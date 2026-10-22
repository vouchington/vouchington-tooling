import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkStoryCoverage } from './check.mts'
import type { SourceModuleGraph } from '../source-module-graph/index.mts'
import {
  coveredComponentKeys,
  namespaceComponentImports,
  reachableStoryFiles,
} from './coverage.mts'
import { componentExports } from './components.mts'
import { analyzeStorySources } from './analyze.mts'
import { storyCoverageConfig, type StoryCoverageRequest } from './options.mts'

const FILES = [
  'ui/components/example.tsx',
  'ui/components/default-value.tsx',
  'ui/components/barrel.ts',
  'ui/stories/example.stories.tsx',
  'ui/stories/story-data.ts',
]

describe('coveredComponentKeys', () => {
  it('records a component import when its export owner cannot be resolved', () => {
    const config = storyCoverageConfig(request('/repo'))
    const graph = {
      resolveSource: (_file: string, specifier: string) =>
        specifier === 'node:fs' ? null : 'ui/components/example.tsx',
      runtimeImports: () => [
        {
          specifier: 'node:fs',
          typeOnly: false,
          span: { start: 0, end: 0 },
          bindings: [],
        },
        {
          specifier: '@/components/example',
          typeOnly: false,
          span: { start: 0, end: 0 },
          bindings: [
            {
              imported: 'Missing',
              local: 'Missing',
              kind: 'named' as const,
              typeOnly: false,
              bindingId: 1,
              span: { start: 0, end: 0 },
            },
          ],
        },
      ],
      reachableFrom: () => [],
      resolveExportOwner: () => null,
    } satisfies SourceModuleGraph
    expect([...coveredComponentKeys(['ui/stories/a.stories.tsx'], graph, config)]).toEqual([
      'ui/components/example.tsx#Missing',
    ])
  })
})

describe('checkStoryCoverage', () => {
  let root: string | undefined

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it('covers used runtime exports and rejects namespace imports', async () => {
    root = await writeTree({
      'ui/components/example.tsx': `
        export type Props = { label: string }
        export function Named() { return <div data-marker="named" /> }
        export const ConstComponent = () => <div data-marker="const" />
        export default function DefaultThing() { return <div data-marker="default" /> }
        const Internal = () => <div data-marker="internal" />
        export { Internal as LocalAlias }
        export enum ComponentState { Ready }
        export const notAComponent = 1
      `,
      'ui/components/default-value.tsx': `
        const lowerCase = () => <div data-marker="lower" />
        export default lowerCase
      `,
      'ui/components/barrel.ts': `
        export { Named as Card } from './example'
        export type { Props } from './example'
        export { notAComponent as Unused } from './example'
      `,
      'ui/stories/example.stories.tsx': `
        import 'node:fs'
        import DefaultThing from '@/components/example'
        import LowerCase from '@/components/default-value'
        import { Card, type Props, Unused } from '@/components/barrel'
        import * as Components from '@/components/example'
        import { storyData } from './story-data'
        function shadow(Unused: string) { return Unused }
        export const Basic = { render: () => <>{storyData}<Card /><DefaultThing /><LowerCase /><Components.Named /></> }
      `,
      'ui/stories/story-data.ts': `export const storyData = 'fixture'`,
    })
    const config = storyCoverageConfig(request(root))
    const analysis = await analyzeStorySources(FILES, config)
    const stories = reachableStoryFiles(FILES, analysis.graph, config)
    expect(stories).toEqual(['ui/stories/example.stories.tsx', 'ui/stories/story-data.ts'])
    expect(componentExports(FILES, analysis.modules, config).map((item) => item.key)).toEqual([
      'ui/components/example.tsx#Named',
      'ui/components/example.tsx#ConstComponent',
      'ui/components/example.tsx#default',
      'ui/components/example.tsx#LocalAlias',
      'ui/components/example.tsx#ComponentState',
      'ui/components/default-value.tsx#default',
    ])
    expect([...coveredComponentKeys(stories, analysis.graph, config)].toSorted()).toEqual([
      'ui/components/barrel.ts#Card',
      'ui/components/default-value.tsx#default',
      'ui/components/example.tsx#Named',
      'ui/components/example.tsx#default',
    ])
    expect(namespaceComponentImports(stories, analysis.graph, config)).toEqual([
      {
        file: 'ui/stories/example.stories.tsx',
        source: '@/components/example',
        local: 'Components',
      },
    ])
    const report = await checkStoryCoverage(request(root), FILES)
    expect(report.ok).toBe(false)
    expect(report.missingComponents.map((item) => item.exportName)).toEqual([
      'ComponentState',
      'ConstComponent',
      'LocalAlias',
    ])
    expect(report.messages.join('\n')).toContain('namespace imports')
  }, 30_000)

  it('passes when every marked export is imported and nothing is excluded', async () => {
    root = await writeTree({
      'ui/components/ok.tsx': `export function Ok() { return <div data-marker="ok" /> }\n`,
      'ui/stories/ok.stories.tsx': `
        import { Ok } from '@/components/ok'
        export const Basic = { render: () => <Ok /> }
      `,
    })
    const report = await checkStoryCoverage(request(root))
    expect(report).toMatchObject({
      ok: true,
      missingComponents: [],
      excludedKeys: [],
      messages: [],
    })
  }, 30_000)

  it('ignores duplicate entries in a caller-supplied file list', async () => {
    root = await writeTree({
      'ui/components/ok.tsx': `export function Ok() { return <div data-marker="ok" /> }\n`,
      'ui/stories/ok.stories.tsx': `
        import { Ok } from '@/components/ok'
        export const Basic = { render: () => <Ok /> }
      `,
    })
    const files = ['ui/components/ok.tsx', 'ui/stories/ok.stories.tsx']
    const report = await checkStoryCoverage(request(root), [...files, ...files])
    expect(report.ok).toBe(true)
  })

  it('fails closed on exclusion keys even when they hide a missing component', async () => {
    root = await writeTree({
      'ui/components/only.tsx': `export function Only() { return <div data-marker="only" /> }\n`,
      'ui/stories/only.stories.tsx': `export const Basic = {}\n`,
    })
    const report = await checkStoryCoverage(
      request(root, { exclusions: { 'ui/components/only.tsx#Only': 'later' } }),
    )
    expect(report.missingComponents).toEqual([])
    expect(report.excludedKeys).toEqual(['ui/components/only.tsx#Only'])
    expect(report.ok).toBe(false)
  })

  it('passes an empty tree and rejects incomplete source', async () => {
    root = await mkdtemp(join(tmpdir(), 'story-check-'))
    await mkdir(join(root, 'ui/components'), { recursive: true })
    await mkdir(join(root, 'ui/stories'), { recursive: true })
    await expect(checkStoryCoverage(request(root))).resolves.toMatchObject({ ok: true })
    const broken = 'ui/stories/broken.stories.tsx'
    await writeFile(join(root, broken), 'export const Broken = <')
    await expect(checkStoryCoverage(request(root), [broken])).rejects.toThrow(
      'Incomplete source module facts',
    )
  })
})

function request(root: string, extra: Partial<StoryCoverageRequest> = {}): StoryCoverageRequest {
  return {
    root,
    componentRoot: 'ui/components',
    storyRoot: 'ui/stories',
    aliases: { '@/': 'ui/' },
    sourceExtensions: ['.tsx', '.ts'],
    componentExtensions: ['.tsx'],
    marker: /data-marker/g,
    storyFilePattern: /\.stories\.tsx$/g,
    ...extra,
  }
}

async function writeTree(sources: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'story-check-'))
  for (const [file, source] of Object.entries(sources)) {
    const target = join(directory, file)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, source)
  }
  return directory
}
