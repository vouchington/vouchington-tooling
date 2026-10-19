import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../index.mts'
import { runStoryCoverage } from './story-coverage.mts'
import type { ParsedStoryCoverage } from '../parse-story-coverage.mts'

describe('story-coverage command', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  let root: string | undefined

  afterEach(async () => {
    stderr.mockClear()
    if (root) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it('exits 0 when coverage is complete', async () => {
    root = await mkdtemp(join(tmpdir(), 'story-cli-'))
    await mkdir(join(root, 'ui/components'), { recursive: true })
    await mkdir(join(root, 'ui/stories'), { recursive: true })
    await writeFile(
      join(root, 'ui/components/ok.tsx'),
      `export function Ok() { return <div data-marker="ok" /> }\n`,
    )
    await writeFile(
      join(root, 'ui/stories/ok.stories.tsx'),
      `import { Ok } from '@/components/ok'\nexport const Basic = { render: () => <Ok /> }\n`,
    )
    await expect(runCli(['node', 'vouchington', 'story-coverage', ...flags(root)])).resolves.toBe(0)
    expect(stderr).not.toHaveBeenCalled()
  })

  it('exits 1 and prints the failure when a component is uncovered', async () => {
    root = await mkdtemp(join(tmpdir(), 'story-cli-miss-'))
    await mkdir(join(root, 'ui/components'), { recursive: true })
    await mkdir(join(root, 'ui/stories'), { recursive: true })
    await writeFile(
      join(root, 'ui/components/only.tsx'),
      `export function Only() { return <div data-marker="only" /> }\n`,
    )
    const code = await runCli([
      'node',
      'vouchington',
      'story-coverage',
      ...flags(root),
      '--exclusions-label',
      'notes.json',
    ])
    expect(code).toBe(1)
    expect(stderr.mock.calls.map((call) => String(call[0])).join('\n')).toContain('notes.json')
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('Component story coverage check failed')
  })

  it('rejects invalid patterns and exclusion files', async () => {
    root = await mkdtemp(join(tmpdir(), 'story-cli-bad-'))
    const parsed = parsedFor(root)
    await expect(runStoryCoverage({ ...parsed, marker: '(' })).rejects.toThrow(
      '--marker is not a valid regular expression',
    )
    await expect(runStoryCoverage({ ...parsed, storyPattern: '(' })).rejects.toThrow(
      '--story-pattern is not a valid regular expression',
    )
    await expect(
      runStoryCoverage({ ...parsed, exclusionsFile: join(root, 'missing.json') }),
    ).rejects.toThrow('could not read exclusions')
    const arrayFile = join(root, 'array.json')
    await writeFile(arrayFile, '[]\n')
    await expect(runStoryCoverage({ ...parsed, exclusionsFile: arrayFile })).rejects.toThrow(
      'must be a JSON object',
    )
    const textFile = join(root, 'text.json')
    await writeFile(textFile, '"nope"\n')
    await expect(runStoryCoverage({ ...parsed, exclusionsFile: textFile })).rejects.toThrow(
      'must be a JSON object',
    )
    const nullFile = join(root, 'null.json')
    await writeFile(nullFile, 'null\n')
    await expect(runStoryCoverage({ ...parsed, exclusionsFile: nullFile })).rejects.toThrow(
      'must be a JSON object',
    )
    const broken = join(root, 'broken.json')
    await writeFile(broken, '{')
    await expect(runStoryCoverage({ ...parsed, exclusionsFile: broken })).rejects.toThrow(
      'could not read exclusions',
    )
    const valid = join(root, 'valid.json')
    await writeFile(valid, '{"ui/components/only.tsx#Only":"later"}\n')
    await expect(runStoryCoverage({ ...parsed, exclusionsFile: valid })).resolves.toBe(1)
  })
})

function flags(root: string): string[] {
  return [
    '--root',
    root,
    '--component-root',
    'ui/components',
    '--story-root',
    'ui/stories',
    '--source-extension',
    '.tsx',
    '--component-extension',
    '.tsx',
    '--marker',
    'data-marker',
    '--story-pattern',
    String.raw`\.stories\.tsx$`,
    '--alias',
    '@/=ui/',
  ]
}

function parsedFor(root: string): ParsedStoryCoverage {
  return {
    kind: 'story-coverage',
    root,
    componentRoot: 'ui/components',
    storyRoot: 'ui/stories',
    aliases: { '@/': 'ui/' },
    sourceExtensions: ['.tsx'],
    componentExtensions: ['.tsx'],
    marker: 'data-marker',
    storyPattern: String.raw`\.stories\.tsx$`,
  }
}
