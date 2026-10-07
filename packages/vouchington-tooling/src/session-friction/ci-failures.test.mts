import { describe, expect, it } from 'vitest'

import { buildCiFailuresSection, getConformingGroups } from './ci-failures.mts'

const FAILURE_GROUP_HEADER = /^- `(recurring|one-off)` — `(.+?)` — .*[^\s]$/
const RUN_URL = 'https://github.com/vouchington/vouchington/actions/runs/1234567890/job/9876543210'
const SHA = '15fa2d3a1b2c3d4e5f60718293a4b5c6d7e8f901'

describe('CI failure block composition', () => {
  it('keeps long headers and evidence whole with no trailing whitespace', () => {
    // The header's 120th character after escaping lands on a space, which used to survive the cut.
    const header = `${'job timeout in merge queue '.repeat(5)}job timeout in merge`
    const evidence = `${RUN_URL} at commit ${SHA}; no-mistakes impact: none, merge-queue check`
    const markdown = [
      `- \`one-off\` — \`GitHub Actions\` — ${header}`,
      `  - Evidence: ${evidence}`,
      '  - Root diagnostic: runner lost connection after 360 minutes',
      '  - Disposition: rerun; no-mistakes impact: none',
    ].join('\n')
    expect(header.length).toBeGreaterThan(120)
    expect(evidence.length).toBeGreaterThan(120)

    const groups = getConformingGroups([{ data: { type: 'journal', markdown } }])
    expect(groups).toHaveLength(1)
    const section = buildCiFailuresSection(
      'session',
      { status: 'ok', markdownBlocks: groups, truncated: false },
      'events',
    )
    const lines = section.split('\n')
    for (const line of lines) expect(line).toBe(line.trimEnd())
    const headerLine = lines.find((line) => line.startsWith('- `'))
    expect(headerLine).toMatch(FAILURE_GROUP_HEADER)
    expect(headerLine).toContain('job timeout in merge')
    expect(headerLine!.endsWith('job timeout in merge')).toBe(true)
    const evidenceLine = lines.find((line) => line.startsWith('  - Evidence: '))!
    expect(evidenceLine).toContain(SHA)
    expect(evidenceLine).toContain(RUN_URL.replaceAll('_', '\\_'))
    expect(evidenceLine).toContain('no\\-mistakes impact: none')
  })

  const entry = (markdown: string) => [{ data: { type: 'journal', markdown } }]
  const block = (evidenceWords: number): string =>
    [
      '- `one-off` — `GitHub Actions` — merge job timed out',
      `  - Evidence: ${RUN_URL} at commit ${SHA} ${'word '.repeat(evidenceWords)}end`,
      `  - Root diagnostic: ${'starved '.repeat(400)}end`,
      '  - Disposition: reran',
    ].join('\n')

  it('cuts Root diagnostic before Evidence when a block must shrink', () => {
    const [group] = getConformingGroups(entry(block(20)), undefined, 700)
    const lines = group!.split('\n')
    expect(lines[1]).toContain(`${RUN_URL} at commit ${SHA} ${'word '.repeat(20)}end`)
    expect(lines[2]).toMatch(/^ {2}- Root diagnostic: (starved )+…$/)
    expect(Buffer.byteLength(group!)).toBeLessThanOrEqual(700)
  })

  it('cuts Evidence only at token boundaries, never inside a URL or SHA', () => {
    const [group] = getConformingGroups(entry(block(200)), undefined, 700)
    const lines = group!.split('\n')
    expect(lines[1]).toMatch(new RegExp(`^ {2}- Evidence: ${RUN_URL} at commit ${SHA} (word )+…$`))
    for (const line of lines) expect(line).toBe(line.trimEnd())
  })

  it('reports omission as a conforming group and never falls back to none observed', () => {
    const groups = getConformingGroups([...entry(block(5)), ...entry(block(5))], undefined, 100)
    expect(groups).toHaveLength(1)
    const lines = groups[0]!.split('\n')
    expect(lines[0]).toMatch(FAILURE_GROUP_HEADER)
    expect(lines[0]).toContain(
      '2 further failure groups omitted to fit the size limit; see journal',
    )
    const section = buildCiFailuresSection(
      'session',
      { status: 'ok', markdownBlocks: groups, truncated: false },
      'events',
    )
    expect(section).toContain('Status: failures observed')
  })
})
