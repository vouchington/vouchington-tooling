import { sectionBody } from './retrospective-validate-ci.mts'

const NON_FINDING = /^Status: (?:none observed|not assessed|unavailable) \(.*\S.*\)$/
const FINDINGS = /^Status: findings(?: \(.*\S.*\))?$/
const STATUS_MAX_BYTES = 320

function findingErrors(header: string, section: string[], bullets: number[]): string[] {
  return bullets.flatMap((position, index) => {
    const group = section.slice(position + 1, bullets[index + 1])
    const missing = ['Evidence', 'Disposition'].filter(
      (field) => !group.some((line) => new RegExp(`^ {2}- ${field}: .*\\S$`).test(line)),
    )
    return missing.length
      ? [
          `"${header}" finding ${JSON.stringify(section[position])} is missing ${missing.map((field) => `"  - ${field}: ..."`).join(' and ')}`,
        ]
      : []
  })
}

function sectionErrors(header: string, section: string[]): string[] {
  const statuses = section.filter((line) => line.startsWith('Status: '))
  if (statuses.length !== 1)
    return [`"${header}" needs exactly one "Status: " line (found ${statuses.length})`]
  const status = statuses[0]!
  if (Buffer.byteLength(status) > STATUS_MAX_BYTES)
    return [`"${header}" status must be at most ${STATUS_MAX_BYTES} bytes`]
  const bullets = section.flatMap((line, index) => (/^- .+\S$/.test(line) ? [index] : []))
  if (NON_FINDING.test(status))
    return bullets.length
      ? [`"${header}" lists findings but its status says there are none; use "Status: findings"`]
      : []
  if (!FINDINGS.test(status))
    return [
      `"${header}" status must be "Status: findings", or "Status: none observed|not assessed|unavailable (<reason>)" with a non-blank reason`,
    ]
  if (bullets.length === 0)
    return [
      `"${header}" says "Status: findings" but lists no finding; add "- <observation>" bullets`,
    ]
  return findingErrors(header, section, bullets)
}

/** Checks `## Tool Findings` and `## Architecture Findings`: one status, evidence per finding. */
export function validateAssessments(lines: string[]): string[] {
  return ['Tool Findings', 'Architecture Findings'].flatMap((title) => {
    const header = `## ${title}`
    const starts = lines.flatMap((line, index) => (line === header ? [index] : []))
    if (starts.length !== 1)
      return [
        starts.length === 0
          ? `missing "${header}" section`
          : `"${header}" must appear exactly once`,
      ]
    return sectionErrors(header, sectionBody(lines, starts[0]!))
  })
}
