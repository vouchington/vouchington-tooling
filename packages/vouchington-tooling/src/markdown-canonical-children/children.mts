import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, relative, sep, win32 } from 'node:path'

import { sourceSegmentAtOffset, type SourceSegment } from './source-map.mts'
import { canonicalWholeFileLinks, fragmentOnlyCanonicalChildTargets } from './child-links.mts'

interface MarkdownSourceLocation {
  file: string
  line: number
}

export interface CanonicalMarkdownComposition {
  content: string
  /**
   * Returns the source that begins a one-based composed line, or throws outside the composition.
   * A line containing inline canonical-child content keeps its first fragment's source; use
   * sourceAtOffset for exact source ownership within mixed-source lines.
   */
  sourceAtLine(line: number): MarkdownSourceLocation
  /** Returns the original source for a composed character offset, or throws outside the composition. */
  sourceAtOffset(offset: number): MarkdownSourceLocation
}

function isInsideRepo(repoRoot: string, path: string): boolean {
  const pathFromRoot = relative(repoRoot, path)
  return pathFromRoot !== '' && !pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot)
}

function trackedPath(repoRoot: string, path: string): string {
  return relative(repoRoot, path).split(sep).join('/')
}

function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length
}

class SourceMappedMarkdownBuilder {
  private readonly sourceByLine: MarkdownSourceLocation[] = []
  private readonly sourceSegments: SourceSegment[] = []
  private startsLine = true
  content = ''

  append(text: string, file: string, firstLine: number): void {
    if (text.length === 0) return
    const start = this.content.length
    this.sourceSegments.push({ end: start + text.length, file, firstLine, start })
    let line = firstLine
    for (const character of text) {
      if (this.startsLine) {
        this.sourceByLine.push({ file, line })
        this.startsLine = false
      }
      this.content += character
      if (character === '\n') {
        this.startsLine = true
        line += 1
      }
    }
  }

  finish(): CanonicalMarkdownComposition {
    const content = this.content
    const sourceAtLine = (line: number) => {
      const source = this.sourceByLine[line - 1]
      if (!source) throw new Error(`No Markdown source mapping for composed line ${line}`)
      return source
    }
    return {
      content,
      sourceAtLine,
      sourceAtOffset: (offset) => {
        if (!Number.isInteger(offset) || offset < 0 || offset >= content.length) {
          throw new Error(`No Markdown source mapping for composed offset ${offset}`)
        }
        const source = sourceSegmentAtOffset(this.sourceSegments, offset)
        return {
          file: source.file,
          line: source.firstLine + content.slice(source.start, offset).split('\n').length - 1,
        }
      },
    }
  }
}

function readCanonicalChild(
  repoRoot: string,
  realRepoRoot: string,
  rootFile: string,
  childPath: string,
  trackedFiles: ReadonlySet<string>,
  contentsByFile: ReadonlyMap<string, string>,
  errors: string[],
): string | undefined {
  const absolutePath = join(repoRoot, childPath)
  try {
    lstatSync(absolutePath)
  } catch {
    errors.push(`::error file=${rootFile}::${rootFile}: canonical child ${childPath} is missing`)
    return undefined
  }
  if (!trackedFiles.has(childPath)) {
    errors.push(
      `::error file=${rootFile}::${rootFile}: canonical child ${childPath} must be a tracked repository file`,
    )
    return undefined
  }
  let realChildPath: string
  try {
    realChildPath = realpathSync(absolutePath)
  } catch {
    errors.push(
      `::error file=${rootFile}::${rootFile}: canonical child ${childPath} target is unreadable or broken`,
    )
    return undefined
  }
  if (!isInsideRepo(realRepoRoot, realChildPath)) {
    errors.push(
      `::error file=${rootFile}::${rootFile}: canonical child ${childPath} must resolve inside the repository`,
    )
    return undefined
  }
  if (!trackedFiles.has(trackedPath(realRepoRoot, realChildPath))) {
    errors.push(
      `::error file=${rootFile}::${rootFile}: canonical child ${childPath} resolved target must be a tracked repository file`,
    )
    return undefined
  }
  try {
    return contentsByFile.get(childPath) ?? readFileSync(realChildPath, 'utf8')
  } catch {
    errors.push(
      `::error file=${rootFile}::${rootFile}: canonical child ${childPath} target is unreadable or broken`,
    )
    return undefined
  }
}

/**
 * Combines a stable index with only its explicitly linked canonical children.
 * Each composed line retains the source file and original line for downstream diagnostics.
 * Canonical children intentionally do not recurse: the index owns the boundary.
 */
export function readCanonicalMarkdownChildren(
  repoRoot: string,
  rootFile: string,
  rootContent: string,
  trackedFiles: readonly string[],
  contentsByFile: ReadonlyMap<string, string>,
  errors: string[],
): CanonicalMarkdownComposition {
  const realRepoRoot = realpathSync(repoRoot)
  const trackedFileSet = new Set(trackedFiles)
  const seen = new Set<string>()
  for (const target of fragmentOnlyCanonicalChildTargets(rootContent)) {
    errors.push(
      `::error file=${rootFile}::${rootFile}: canonical child ${target} is linked only by a fragment; add a whole-file Markdown link for composition`,
    )
  }
  const builder = new SourceMappedMarkdownBuilder()
  let cursor = 0
  for (const { index, link, target } of canonicalWholeFileLinks(rootContent)) {
    builder.append(rootContent.slice(cursor, index), rootFile, lineAt(rootContent, cursor))
    const childPath = trackedPath(repoRoot, normalize(join(repoRoot, dirname(rootFile), target)))
    if (
      isAbsolute(target) ||
      win32.isAbsolute(target) ||
      !isInsideRepo(repoRoot, join(repoRoot, childPath))
    ) {
      errors.push(
        `::error file=${rootFile}::${rootFile}: canonical child ${target} must stay inside the repository`,
      )
      builder.append(link, rootFile, lineAt(rootContent, index))
    } else if (!seen.has(childPath)) {
      seen.add(childPath)
      const childContent = readCanonicalChild(
        repoRoot,
        realRepoRoot,
        rootFile,
        childPath,
        trackedFileSet,
        contentsByFile,
        errors,
      )
      if (childContent === undefined) builder.append(link, rootFile, lineAt(rootContent, index))
      else builder.append(childContent, childPath, 1)
    }
    cursor = index + link.length
  }
  builder.append(rootContent.slice(cursor), rootFile, lineAt(rootContent, cursor))
  return builder.finish()
}
