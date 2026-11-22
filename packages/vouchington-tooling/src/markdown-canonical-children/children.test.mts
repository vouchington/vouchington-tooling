import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { readCanonicalMarkdownChildren } from './children.mts'
import { sourceSegmentAtOffset } from './source-map.mts'

const ROOT_FILE = 'docs/parent.md'
describe('readCanonicalMarkdownChildren', () => {
  const testDirs: string[] = []

  afterEach(() => {
    for (const dir of testDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  })

  function write(repoRoot: string, path: string, content: string): void {
    mkdirSync(dirname(join(repoRoot, path)), { recursive: true })
    writeFileSync(join(repoRoot, path), content)
  }

  function run(
    rootContent: string,
    files: Record<string, string>,
    trackedFiles: readonly string[],
  ): { content: string; errors: string[] } {
    const repoRoot = mkdtempSync(join(tmpdir(), 'canonical-markdown-children-'))
    testDirs.push(repoRoot)
    for (const [path, content] of Object.entries(files)) write(repoRoot, path, content)
    const errors: string[] = []
    const content = readCanonicalMarkdownChildren(
      repoRoot,
      ROOT_FILE,
      rootContent,
      trackedFiles,
      new Map(),
      errors,
    )
    return { content: content.content, errors }
  }

  it('reports a missing canonical child', () => {
    const { errors } = run('- <a id="missing-child"></a>[Missing child](missing.md)', {}, [
      ROOT_FILE,
    ])

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('canonical child docs/missing.md is missing'),
      ]),
    )
  })

  it('rejects a canonical child outside the parent repository', () => {
    const { errors } = run('- <a id="outside-child"></a>[Outside child](../../outside.md)', {}, [
      ROOT_FILE,
    ])

    expect(errors).toEqual(
      expect.arrayContaining([expect.stringContaining('must stay inside the repository')]),
    )
  })

  it('leaves an absolute child link untouched', () => {
    const { content, errors } = run('- [Outside child](/tmp/outside.md)', {}, [ROOT_FILE])

    expect(errors).toEqual([])
    expect(content).toBe('- [Outside child](/tmp/outside.md)')
  })

  it('rejects an existing canonical child that is not tracked', () => {
    const { errors } = run('- <a id="child"></a>[Child](child.md)', { 'docs/child.md': 'Child.' }, [
      ROOT_FILE,
    ])

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('canonical child docs/child.md must be a tracked repository file'),
      ]),
    )
  })

  it('reads only directly linked canonical children without recursing', () => {
    const { content, errors } = run(
      '- <a id="child"></a>[Child](child.md)',
      {
        'docs/child.md': 'Child [Read this section](grandchild.md)',
        'docs/grandchild.md': 'Grandchild.',
      },
      [ROOT_FILE, 'docs/child.md', 'docs/grandchild.md'],
    )

    expect(errors).toEqual([])
    expect(content).toContain('Child [Read this section](grandchild.md)')
    expect(content).not.toContain('Grandchild.')
  })

  it('deduplicates repeated links to the same canonical child', () => {
    const { content, errors } = run(
      '- <a id="child"></a>[Child](child.md)\n- <a id="child-again"></a>[Child again](child.md)',
      { 'docs/child.md': 'Child.' },
      [ROOT_FILE, 'docs/child.md'],
    )

    expect(errors).toEqual([])
    expect(content).toBe('Child.\n')
  })

  it("retains each composed line's source file and original line", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'canonical-markdown-children-'))
    testDirs.push(repoRoot)
    write(repoRoot, 'docs/child.md', 'Child line one.\nChild line two.')
    const errors: string[] = []

    const composition = readCanonicalMarkdownChildren(
      repoRoot,
      ROOT_FILE,
      'Parent line one.\n- <a id="child"></a>[Child](child.md)\nParent line three.',
      [ROOT_FILE, 'docs/child.md', 'docs/targets/child.md'],
      new Map(),
      errors,
    )

    expect(errors).toEqual([])
    expect(composition.content).toBe(
      'Parent line one.\nChild line one.\nChild line two.\nParent line three.',
    )
    expect(composition.sourceAtLine(1)).toEqual({ file: ROOT_FILE, line: 1 })
    expect(composition.sourceAtLine(2)).toEqual({ file: 'docs/child.md', line: 1 })
    expect(composition.sourceAtLine(3)).toEqual({ file: 'docs/child.md', line: 2 })
    expect(composition.sourceAtLine(4)).toEqual({ file: ROOT_FILE, line: 3 })
    expect(composition.sourceAtOffset(0)).toEqual({ file: ROOT_FILE, line: 1 })
    expect(composition.sourceAtOffset(composition.content.indexOf('\n'))).toEqual({
      file: ROOT_FILE,
      line: 1,
    })
    expect(() => composition.sourceAtLine(99)).toThrow(
      'No Markdown source mapping for composed line',
    )
    for (const offset of [composition.content.length, 0.5, -1])
      expect(() => composition.sourceAtOffset(offset)).toThrow(
        'No Markdown source mapping for composed offset',
      )
  })

  it('maps offsets within inline parent and canonical child fragments exactly', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'canonical-markdown-children-'))
    testDirs.push(repoRoot)
    write(repoRoot, 'docs/child.md', 'child first\nchild second')
    const errors: string[] = []
    const composition = readCanonicalMarkdownChildren(
      repoRoot,
      ROOT_FILE,
      'parent prefix\n- <a id="child"></a>[Child](child.md)\nnext parent line',
      [ROOT_FILE, 'docs/child.md'],
      new Map(),
      errors,
    )

    expect(errors).toEqual([])
    expect(composition.content).toBe('parent prefix\nchild first\nchild second\nnext parent line')
    expect(composition.sourceAtLine(1)).toEqual({ file: ROOT_FILE, line: 1 })
    expect(composition.sourceAtOffset(composition.content.indexOf('child first'))).toEqual({
      file: 'docs/child.md',
      line: 1,
    })
    expect(composition.sourceAtOffset(composition.content.indexOf('child second'))).toEqual({
      file: 'docs/child.md',
      line: 2,
    })
    expect(composition.sourceAtOffset(composition.content.indexOf('next parent line'))).toEqual({
      file: ROOT_FILE,
      line: 3,
    })
    expect(composition.sourceAtOffset(composition.content.indexOf('\n'))).toEqual({
      file: ROOT_FILE,
      line: 1,
    })
  })

  it('accepts a tracked canonical child symlink whose target stays in the repository', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'canonical-markdown-children-'))
    testDirs.push(repoRoot)
    write(repoRoot, 'docs/targets/child.md', 'Child.')
    symlinkSync('targets/child.md', join(repoRoot, 'docs/child.md'))
    const errors: string[] = []

    const composition = readCanonicalMarkdownChildren(
      repoRoot,
      ROOT_FILE,
      '- <a id="child"></a>[Child](child.md)',
      [ROOT_FILE, 'docs/child.md', 'docs/targets/child.md'],
      new Map(),
      errors,
    )

    expect(errors).toEqual([])
    expect(composition.content).toBe('Child.')
  })

  it('rejects a tracked canonical child symlink whose resolved target is untracked', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'canonical-markdown-children-'))
    testDirs.push(repoRoot)
    write(repoRoot, 'docs/targets/child.md', 'Child.')
    symlinkSync('targets/child.md', join(repoRoot, 'docs/child.md'))
    const errors: string[] = []

    readCanonicalMarkdownChildren(
      repoRoot,
      ROOT_FILE,
      '- <a id="child"></a>[Child](child.md)',
      [ROOT_FILE, 'docs/child.md'],
      new Map([['docs/child.md', 'Bypass attempt.']]),
      errors,
    )

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('resolved target must be a tracked repository file'),
      ]),
    )
  })

  it('rejects a tracked canonical child symlink whose target escapes the repository', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'canonical-markdown-children-'))
    const outsideRoot = mkdtempSync(join(tmpdir(), 'canonical-markdown-outside-'))
    testDirs.push(repoRoot, outsideRoot)
    write(outsideRoot, 'child.md', 'Outside.')
    mkdirSync(join(repoRoot, 'docs'), { recursive: true })
    symlinkSync(join(outsideRoot, 'child.md'), join(repoRoot, 'docs/child.md'))
    const errors: string[] = []

    readCanonicalMarkdownChildren(
      repoRoot,
      ROOT_FILE,
      '- <a id="child"></a>[Child](child.md)',
      [ROOT_FILE, 'docs/child.md'],
      new Map(),
      errors,
    )

    expect(errors).toEqual(
      expect.arrayContaining([expect.stringContaining('must resolve inside the repository')]),
    )
  })

  it('rejects a tracked canonical child that cannot be read as a file', () => {
    const { errors } = run(
      '- <a id="child"></a>[Child](child.md)',
      { 'docs/child.md/inner.txt': 'x' },
      [ROOT_FILE, 'docs/child.md'],
    )

    expect(errors).toEqual(
      expect.arrayContaining([expect.stringContaining('target is unreadable or broken')]),
    )
  })

  it('rejects a tracked canonical child symlink with a broken target', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'canonical-markdown-children-'))
    testDirs.push(repoRoot)
    mkdirSync(join(repoRoot, 'docs'), { recursive: true })
    symlinkSync('missing.md', join(repoRoot, 'docs/child.md'))
    const errors: string[] = []

    readCanonicalMarkdownChildren(
      repoRoot,
      ROOT_FILE,
      '- <a id="child"></a>[Child](child.md)',
      [ROOT_FILE, 'docs/child.md'],
      new Map(),
      errors,
    )

    expect(errors).toEqual(
      expect.arrayContaining([expect.stringContaining('target is unreadable or broken')]),
    )
  })
})

describe('sourceSegmentAtOffset', () => {
  it('throws for an offset outside every segment', () => {
    expect(() =>
      sourceSegmentAtOffset([{ end: 2, file: 'a.md', firstLine: 1, start: 0 }], 5),
    ).toThrow('No Markdown source segment for composed offset 5')
  })
})
