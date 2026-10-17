import { describe, expect, it } from 'vitest'

import {
  buildCiFailuresSection,
  getConformingGroups,
  isConformingCiFailureBlock,
} from './ci-failures.mts'
import type { JournalEntry } from './types.mts'

const FAILURE_GROUP_HEADER = /^- `(recurring|one-off)` — `(.+?)` — .*[^\s]$/
const RUN_URL = 'https://github.com/vouchington/vouchington/actions/runs/1234567890/job/9876543210'
const SHA = '15fa2d3a1b2c3d4e5f60718293a4b5c6d7e8f901'

const conforming = [
  '- `one-off` — `GitHub Actions` — build cache failure',
  '  - Evidence: CI run 123 failed',
  '  - Root diagnostic: cache corruption',
  '  - Disposition: rebuilt cache',
].join('\n')

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
    const section = buildCiFailuresSection(groups)
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
    const section = buildCiFailuresSection(groups)
    expect(section).toContain('Status: failures observed')
  })
})

describe('CI failure grammar', () => {
  it('accepts the complete block and rejects partial/trailing content', () => {
    expect(isConformingCiFailureBlock(conforming)).toBe(true)
    expect(isConformingCiFailureBlock(`\n\n${conforming.replaceAll('\n', '\r\n')}\n`)).toBe(true)
    expect(isConformingCiFailureBlock(`${conforming}\nextra`)).toBe(false)
    expect(isConformingCiFailureBlock(conforming.split('\n').slice(0, 2).join('\n'))).toBe(false)
    expect(isConformingCiFailureBlock(`${conforming} `)).toBe(false)
    expect(isConformingCiFailureBlock(`${conforming}${'x'.repeat(10_000)}`)).toBe(false)
    expect(isConformingCiFailureBlock(`${conforming}${'é'.repeat(5_000)}`)).toBe(false)
    expect(isConformingCiFailureBlock(conforming.replace('cache corruption', '\ud800'))).toBe(false)
    expect(
      getConformingGroups([
        {
          data: {
            type: 'journal',
            markdown: conforming.replace('cache corruption', '~~hidden~~'),
          },
        },
      ])[0],
    ).toContain('\\~\\~hidden\\~\\~')
    expect(
      getConformingGroups([
        { data: { type: 'journal', markdown: conforming.replace('cache corruption', '&nbsp;') } },
      ])[0],
    ).toContain('\\&nbsp;')
    expect(
      isConformingCiFailureBlock(
        conforming.replace('build cache failure', '\u202e').replace('CI run 123 failed', '\u202e'),
      ),
    ).toBe(false)
    expect(
      isConformingCiFailureBlock(
        conforming
          .replace('build cache failure', '\u200b')
          .replace('CI run 123 failed', '\u200b')
          .replace('cache corruption', '\u200b')
          .replace('rebuilt cache', '\u200b'),
      ),
    ).toBe(false)
    expect(getConformingGroups([{ data: { type: 'journal', markdown: 42 } }])).toEqual([])
    expect(getConformingGroups([null] as unknown as JournalEntry[])).toEqual([])
  })
})
