const DETAILS_OPEN = /<details(?:\s[^>]*)?>/gi
const DETAILS_CLOSE = /<\/details>/gi
const SUMMARY = '<summary>Shepherd Journal</summary>'
const LEGACY = /^##[ \t]+Shepherd[ \t]+Journal[ \t]*$/
const H2 = /^##(?!#)/
const FENCE = /^ {0,3}(`{3,}|~{3,})/

const count = (line: string, expression: RegExp): number => [...line.matchAll(expression)].length

/** The lines with every fenced code block blanked, so journal-shaped examples there never match. */
function outsideFences(lines: string[]): string[] {
  let fence: string | undefined
  return lines.map((line) => {
    const marker = FENCE.exec(line)?.[1]
    if (fence === undefined) {
      if (marker === undefined) return line
      fence = marker
      return ''
    }
    if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length)
      fence = undefined
    return ''
  })
}

function detailsStarts(lines: string[]): number[] {
  return lines.flatMap((line, index) =>
    line.trim() === SUMMARY && lines[index - 1]?.trim() === '<details>' ? [index] : [],
  )
}

function detailsBlock(lines: string[], start: number): string[] | undefined {
  let depth = 1
  for (const [index, line] of lines.entries()) {
    if (index < start) continue
    depth += count(line, DETAILS_OPEN) - count(line, DETAILS_CLOSE)
    if (depth <= 0) return lines.slice(start - 1, index + 1)
  }
  return undefined
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
 * one candidate is ambiguous and throws rather than guessing which history to keep.
 */
export function findShepherdJournal(body: string): string | undefined {
  const lines = body.replaceAll('\r\n', '\n').split('\n')
  const visible = outsideFences(lines)
  const details = detailsStarts(visible)
  const legacy = visible.flatMap((line, index) => (LEGACY.test(line) ? [index] : []))
  if (details.length + legacy.length > 1)
    throw new Error('the pull request body has more than one Shepherd Journal; resolve it by hand')
  // Blocks are sliced from the original lines, so a fenced example inside the journal is kept.
  if (details.length === 1) return detailsBlock(lines, details[0]!)?.join('\n')
  return legacy.length === 1 ? legacySection(lines, visible, legacy[0]!).join('\n') : undefined
}

/**
 * Appends the live body's journal to `rendered`. The rendered fields must not carry a journal of
 * their own: the live one is the only history, so a second copy is rejected instead of dropped.
 */
export function preserveShepherdJournal(rendered: string, live: string): string {
  if (findShepherdJournal(rendered) !== undefined)
    throw new Error(
      'the pull request fields contain a Shepherd Journal; the server preserves the live one',
    )
  const journal = findShepherdJournal(live)
  return journal === undefined ? rendered : `${rendered.trimEnd()}\n\n${journal}\n`
}
