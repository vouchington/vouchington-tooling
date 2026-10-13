const DETAILS_OPEN = /<details(?:\s[^>]*)?>/gi
const DETAILS_CLOSE = /<\/details>/gi
const SUMMARY = '<summary>Shepherd Journal</summary>'
const LEGACY = /^##[ \t]+Shepherd[ \t]+Journal[ \t]*$/
const H2 = /^##(?!#)/

const count = (line: string, expression: RegExp): number => [...line.matchAll(expression)].length

function detailsBlock(lines: string[]): string[] | undefined {
  const start = lines.findIndex(
    (line, index) => line.trim() === SUMMARY && lines[index - 1]?.trim() === '<details>',
  )
  if (start === -1) return undefined
  let depth = 1
  for (const [index, line] of lines.entries()) {
    if (index < start) continue
    depth += count(line, DETAILS_OPEN) - count(line, DETAILS_CLOSE)
    if (depth <= 0) return lines.slice(start - 1, index + 1)
  }
  return undefined
}

function legacySection(lines: string[]): string[] | undefined {
  const start = lines.findIndex((line) => LEGACY.test(line))
  if (start === -1) return undefined
  const next = lines.findIndex((line, index) => index > start && H2.test(line))
  const section = lines.slice(start, next === -1 ? lines.length : next)
  while (section.at(-1)?.trim() === '') section.pop()
  return section
}

/**
 * The Shepherd Journal of a pull request body, verbatim: a `<details>` block whose summary is
 * "Shepherd Journal", else a legacy `## Shepherd Journal` section running to the next H2 or the
 * end. Undefined when the body has none.
 */
export function findShepherdJournal(body: string): string | undefined {
  const lines = body.replaceAll('\r\n', '\n').split('\n')
  return (detailsBlock(lines) ?? legacySection(lines))?.join('\n')
}

/** Appends the live body's journal to `rendered` unless `rendered` already carries one. */
export function preserveShepherdJournal(rendered: string, live: string): string {
  if (findShepherdJournal(rendered) !== undefined) return rendered
  const journal = findShepherdJournal(live)
  return journal === undefined ? rendered : `${rendered.trimEnd()}\n\n${journal}\n`
}
