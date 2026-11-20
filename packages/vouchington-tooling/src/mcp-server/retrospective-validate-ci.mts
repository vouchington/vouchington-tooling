const CI_HEADER = '## CI Failures'
const TRANSCRIPT_HEADER = '## Transcript Facts'
const GROUP = /^- `(?:recurring|one-off)` — `(.+?)` — .*[^\s]$/
const FIELDS = [
  /^ {2}- Evidence: .*[^\s]$/,
  /^ {2}- Root diagnostic: .*[^\s]$/,
  /^ {2}- Disposition: .*[^\s]$/,
]
const EXCLUDED_NOTE = /^Excluded: .*[^\s]$/
const UNAVAILABLE = /^Status: unavailable \(.*\S.*\)$/
const SOURCE = 'GitHub Actions'
const STATUS_CHOICES =
  '"Status: failures observed", "Status: none observed", or "Status: unavailable (<non-blank reason>)"'

type Group = { source: string; fields: number }

/** The lines of the section whose header is at `start`, up to the next `## ` header. */
export function sectionBody(lines: string[], start: number): string[] {
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines.slice(start + 1, next < 0 ? undefined : next)
}

function groupsOf(body: string[]): { groups: Group[]; unexpected: string[] } {
  const groups: Group[] = []
  const unexpected: string[] = []
  for (const line of body) {
    const header = GROUP.exec(line)
    const current = groups.at(-1)
    if (header) groups.push({ source: header[1]!, fields: 0 })
    else if (current && FIELDS[current.fields]?.test(line)) current.fields++
    else if (!/^\s*$/.test(line) && !line.startsWith('Status: ') && !EXCLUDED_NOTE.test(line))
      unexpected.push(line)
  }
  return { groups, unexpected }
}

function statusErrors(statuses: string[], groupCount: number): string[] {
  if (statuses.length !== 1)
    return [
      `"${CI_HEADER}" must contain exactly one "Status: " line (found ${statuses.length}); use ${STATUS_CHOICES}`,
    ]
  const status = statuses[0]!
  if (status === 'Status: failures observed')
    return groupCount === 0
      ? [`"Status: failures observed" requires at least one failure group under "${CI_HEADER}"`]
      : []
  if (status === 'Status: none observed')
    return groupCount > 0
      ? [
          `failure groups are present but "${CI_HEADER}" says "Status: none observed"; use "Status: failures observed"`,
        ]
      : []
  if (UNAVAILABLE.test(status)) return []
  return [`"${CI_HEADER}" status ${JSON.stringify(status)} is invalid; use ${STATUS_CHOICES}`]
}

/** Checks `## CI Failures`: placement after Transcript Facts, one Status line, and group grammar. */
export function validateCiFailures(lines: string[]): string[] {
  const starts = lines.flatMap((line, index) => (line === CI_HEADER ? [index] : []))
  if (starts.length !== 1)
    return [
      starts.length === 0
        ? `missing "${CI_HEADER}" section header`
        : `"${CI_HEADER}" must appear exactly once`,
    ]
  const start = starts[0]!
  const errors: string[] = []
  const transcript = lines.indexOf(TRANSCRIPT_HEADER)
  const between = lines.slice(transcript + 1, start).some((line) => line.startsWith('## '))
  if (transcript >= 0 && (transcript > start || between))
    errors.push(`"${CI_HEADER}" must come immediately after "${TRANSCRIPT_HEADER}"`)
  const body = sectionBody(lines, start)
  const { groups, unexpected } = groupsOf(body)
  errors.push(
    ...statusErrors(
      body.filter((line) => line.startsWith('Status: ')),
      groups.length,
    ),
  )
  if (groups.some((group) => group.fields < FIELDS.length))
    errors.push(
      'each failure group needs indented "  - Evidence:", "  - Root diagnostic:" and "  - Disposition:" lines, in that order, each non-blank',
    )
  const other = [...new Set(groups.map((group) => group.source))].filter(
    (source) => source !== SOURCE,
  )
  if (other.length)
    errors.push(
      `failure group source must be \`${SOURCE}\`, not ${other.map((name) => `\`${name}\``).join(', ')}`,
    )
  if (unexpected.length)
    errors.push(
      `unexpected content inside "${CI_HEADER}": ${JSON.stringify(unexpected[0])}; only Status, an optional "Excluded:" note, and failure groups are allowed`,
    )
  return errors
}
