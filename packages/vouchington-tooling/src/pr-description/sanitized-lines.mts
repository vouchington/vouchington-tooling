import { markdownHtmlBlocks, markdownLiteralSpans } from '../markdown/index.mts'

// CommonMark measures fence indentation in columns, with a tab advancing to the next multiple of
// four; from column 0 a single tab always lands on column 4 or later, past the three-column budget.
// Admit literal spaces only so a tab-indented look-alike inside a code block never closes a fence.
function isClosingFenceLine(line: string, fence: { character: string; length: number }): boolean {
  const closing = /^ {0,3}(?<rest>.*?)[ \t]*$/.exec(line)!.groups!.rest!
  return (
    closing.length >= fence.length &&
    Array.from(closing).every((candidate) => candidate === fence.character)
  )
}

function unfencedLines(body: string): string[] {
  const lines: string[] = []
  let fence: { character: string; length: number } | undefined

  for (const line of body.split(/\r?\n/)) {
    if (fence === undefined) {
      const opening = /^ {0,3}(?<fence>`{3,}|~{3,})/.exec(line)?.groups?.fence
      if (opening === undefined) {
        lines.push(line)
      } else {
        lines.push('')
        fence = { character: opening[0]!, length: opening.length }
      }
      continue
    }

    if (isClosingFenceLine(line, fence)) {
      fence = undefined
    }
  }

  return lines
}

// Complete single-line HTML comments (e.g. validation markers) are left untouched so exact-line
// checks can read them. Multi-line comments that span lines are blanked so hidden lines cannot
// satisfy structural checks. Multiple delimiter pairs on one line are scanned left to right.
function stripHtmlComments(lines: string[]): string[] {
  const stripped: string[] = []
  let inComment = false

  for (const line of lines) {
    let hidden = inComment
    let index = 0

    for (;;) {
      if (inComment) {
        const closeIndex = line.indexOf('-->', index)
        if (closeIndex === -1) break
        inComment = false
        index = closeIndex + 3
        continue
      }

      const openIndex = line.indexOf('<!--', index)
      if (openIndex === -1) break
      const closeIndex = line.indexOf('-->', openIndex + 4)
      if (closeIndex === -1) {
        inComment = true
        hidden = true
        break
      }
      index = closeIndex + 3
    }

    stripped.push(hidden ? '' : line)
  }

  return stripped
}

// CommonMark raw-HTML-block openers (CDATA, declarations, processing instructions) that GitHub
// renders invisibly across lines until their closer. Declaration letters are case-insensitive.
const HIDDEN_HTML_OPENER_RE = /<!\[CDATA\[|<![A-Za-z]|<\?/g

function hiddenHtmlCloserFor(opener: string): string {
  if (opener === '<![CDATA[') return ']]>'
  return opener.startsWith('<?') ? '?>' : '>'
}

function isBlockStartIndex(line: string, index: number): boolean {
  return index <= 3 && /^ *$/.test(line.slice(0, index))
}

function stripOtherRawHtmlBlocks(lines: string[]): string[] {
  const stripped: string[] = []
  let activeCloser: string | undefined

  for (const line of lines) {
    let hidden = activeCloser !== undefined
    let index = 0

    for (;;) {
      if (activeCloser !== undefined) {
        const closeIndex = line.indexOf(activeCloser, index)
        if (closeIndex === -1) break
        index = closeIndex + activeCloser.length
        activeCloser = undefined
        continue
      }

      HIDDEN_HTML_OPENER_RE.lastIndex = index
      const match = HIDDEN_HTML_OPENER_RE.exec(line)
      if (match === null) break

      const closer = hiddenHtmlCloserFor(match[0])
      const closeIndex = line.indexOf(closer, HIDDEN_HTML_OPENER_RE.lastIndex)
      if (closeIndex === -1) {
        if (isBlockStartIndex(line, match.index)) {
          hidden = true
          activeCloser = closer
        }
        break
      }

      hidden = true
      index = closeIndex + closer.length
    }

    stripped.push(hidden ? '' : line)
  }

  return stripped
}

// Read all facts from the pristine body; blanking lines first would change Markdown boundaries.
function stripMarkdownLiteralLines(body: string): string[] {
  const lines = body.split(/\r?\n/)
  const positions = [
    ...markdownHtmlBlocks(body).map((fact) => fact.position),
    ...markdownLiteralSpans(body).flatMap((span) =>
      span.kind === 'inline-code' ? [span.position] : [],
    ),
  ]
  for (const position of positions) {
    for (let line = position.start.line; line <= position.end.line; line += 1) {
      lines[line - 1] = ''
    }
  }
  return lines
}

/**
 * Turns a PR body into lines safe for structural matching: fenced code blocks, inline code spans,
 * CommonMark type 1/6/7 raw HTML blocks, multi-line HTML comments, and invisible raw HTML blocks
 * (processing instructions, CDATA, declarations) are blanked while single-line HTML comments
 * remain intact for exact-line marker checks.
 */
export function sanitizedLines(body: string): string[] {
  return stripOtherRawHtmlBlocks(
    stripHtmlComments(unfencedLines(stripMarkdownLiteralLines(body).join('\n'))),
  )
}
