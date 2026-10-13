const DETAILS_OPEN = /<details(?:\s[^>]*)?>/gi
const DETAILS_CLOSE = /<\/details>/gi
const SUMMARY = '<summary>Shepherd Journal</summary>'
/** An ATX H2 "Shepherd Journal", with optional indent and closing hashes. */
const LEGACY = /^ {0,3}##[ \t]+Shepherd[ \t]+Journal(?:[ \t]+#+)?[ \t]*$/
/** A real ATX H2: `##` then whitespace or the end of the line (so not `###` or `##text`). */
const H2 = /^ {0,3}##(?:[ \t]|$)/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
/** A closing fence carries nothing but whitespace after its marker. */
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

const count = (line: string, expression: RegExp): number => [...line.matchAll(expression)].length

/**
 * The lines with every fenced code block blanked, so journal-shaped examples there never match,
 * and whether the text ends inside a fence that never closed.
 */
function outsideFences(lines: string[]): { visible: string[]; open: boolean } {
  let fence: string | undefined
  const visible = lines.map((line) => {
    if (fence === undefined) {
      const marker = FENCE.exec(line)?.[1]
      if (marker === undefined) return line
      fence = marker
      return ''
    }
    const marker = CLOSING_FENCE.exec(line)?.[1]
    if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length)
      fence = undefined
    return ''
  })
  return { visible, open: fence !== undefined }
}

function detailsStarts(lines: string[]): number[] {
  return lines.flatMap((line, index) =>
    line.trim() === SUMMARY && lines[index - 1]?.trim() === '<details>' ? [index] : [],
  )
}

/** Depth is tracked on the fence-blanked lines; the block is sliced from the original ones. */
function detailsBlock(lines: string[], visible: string[], start: number): string[] {
  let depth = 1
  for (const [index, line] of visible.entries()) {
    if (index < start) continue
    depth += count(line, DETAILS_OPEN) - count(line, DETAILS_CLOSE)
    if (depth <= 0) return lines.slice(start - 1, index + 1)
  }
  // Treating an unclosed journal as absent would let an update overwrite its history.
  throw new Error('the Shepherd Journal <details> block is never closed; repair it by hand')
}

function legacySection(lines: string[], visible: string[], start: number): string[] {
  const next = visible.findIndex((line, index) => index > start && H2.test(line))
  const section = lines.slice(start, next === -1 ? lines.length : next)
  while (section.at(-1)?.trim() === '') section.pop()
  return section
}

/**
 * The Shepherd Journal of a pull request body, verbatim: a `<details>` block whose summary is
 * "Shepherd Journal", else a legacy `## Shepherd Journal` section running to the next H2 or the
 * end. Examples inside fenced code blocks are ignored. Undefined when the body has none; more than
 * one candidate, or an unclosed one, is ambiguous and throws rather than guessing.
 */
export function findShepherdJournal(body: string): string | undefined {
  const lines = body.replaceAll('\r\n', '\n').split('\n')
  const { visible } = outsideFences(lines)
  const details = detailsStarts(visible)
  const legacy = visible.flatMap((line, index) => (LEGACY.test(line) ? [index] : []))
  if (details.length + legacy.length > 1)
    throw new Error('the pull request body has more than one Shepherd Journal; resolve it by hand')
  if (details.length === 1) return detailsBlock(lines, visible, details[0]!).join('\n')
  return legacy.length === 1 ? legacySection(lines, visible, legacy[0]!).join('\n') : undefined
}

/**
 * Appends the live body's journal to `rendered`. The rendered fields must not carry a journal of
 * their own, and must not leave a code fence open: the journal would be hidden inside it.
 */
export function preserveShepherdJournal(rendered: string, live: string): string {
  if (findShepherdJournal(rendered) !== undefined)
    throw new Error(
      'the pull request fields contain a Shepherd Journal; the server preserves the live one',
    )
  const journal = findShepherdJournal(live)
  if (journal === undefined) return rendered
  if (outsideFences(rendered.replaceAll('\r\n', '\n').split('\n')).open)
    throw new Error('the pull request fields leave a code fence open; close it')
  return `${rendered.trimEnd()}\n\n${journal}\n`
}
