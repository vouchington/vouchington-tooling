import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  JOURNAL_ARGS,
  harness,
  jsonOf,
  textOf,
  useFixedClock,
  useRepoFixture,
} from './harness.test-helpers.mts'
import type { PolicyOutcome, PolicyRequest } from './policy-spawn.mts'
import { ASSESSED_SECTIONS, UNASSESSED_SECTIONS } from './retrospective-sections.test-helpers.mts'

const fixture = useRepoFixture()
useFixedClock()

const front = (status: string): string =>
  [
    '---',
    'date: "2026-01-01"',
    'issues: [12]',
    'prs: [5]',
    'work_outcome: "success"',
    `feedback_coverage: ${JSON.stringify({ status, sources: ['tool-result'], droppedCount: 0 })}`,
    '---',
    '',
  ].join('\n')
const { markdown: _markdown, sourceEventId: _sourceEventId, ...BASE } = JOURNAL_ARGS
const save = (markdown: string, status = 'complete') => ({
  ...BASE,
  feedbackCoverage: { status, sources: ['tool-result'], droppedCount: 0 },
  markdown,
})

function declarePolicy(): void {
  writeFileSync(
    join(fixture().main, 'package.json'),
    JSON.stringify({ 'vouchington-tooling': { policy: 'policy.mts' } }),
  )
  writeFileSync(join(fixture().main, 'policy.mts'), '')
}

describe('retrospective_save validates markdown by default', () => {
  it('saves a conforming document without a policy module', async () => {
    const h = harness(fixture())
    const result = jsonOf(
      await h.call('retrospective_save', save(front('complete') + ASSESSED_SECTIONS)),
    )
    expect(result.status).toBe('delivered')
  })

  it('rejects a malformed document with every problem, and writes nothing', async () => {
    const h = harness(fixture())
    const result = await h.call('retrospective_save', save(`${front('complete')}Only prose.`))
    expect(result.isError).toBe(true)
    const text = textOf(result)
    expect(text).toContain('retrospective markdown is malformed:')
    expect(text).toContain('- missing the required line "## Verifiable Facts"')
    expect(text).toContain('- missing "## CI Failures" section header')
    expect(text).toContain('- missing "## Tool Findings" section')
    expect(h.fake.stored).toHaveLength(0)
  })

  it('rejects complete coverage over unassessed sources, and accepts partial coverage', async () => {
    const h = harness(fixture())
    const markdown = front('complete') + UNASSESSED_SECTIONS
    const rejected = await h.call('retrospective_save', save(markdown))
    expect(textOf(rejected)).toContain('feedbackCoverage "complete" contradicts unassessed sources')
    expect(h.fake.stored).toHaveLength(0)
    const partial = await h.call(
      'retrospective_save',
      save(front('partial') + UNASSESSED_SECTIONS, 'partial'),
    )
    expect(partial.isError).toBeUndefined()
  })

  it('runs before the policy module, which still runs for a conforming document', async () => {
    const requests: string[] = []
    declarePolicy()
    const spawnPolicy = async (request: PolicyRequest): Promise<PolicyOutcome> => {
      const { export: name } = JSON.parse(request.input) as { export: string }
      requests.push(name)
      const result = name === 'validateRetrospective' ? { errors: ['policy says no'] } : undefined
      const stdout = result === undefined ? { ok: true, skipped: true } : { ok: true, result }
      return {
        exitCode: 0,
        stdout: JSON.stringify(stdout),
        stderr: '',
        timedOut: false,
        overflowed: false,
      }
    }
    const h = harness(fixture(), { spawnPolicy })
    const malformed = await h.call('retrospective_save', save(front('complete')))
    expect(textOf(malformed)).toContain('retrospective markdown is malformed')
    expect(requests).toEqual([])
    const conforming = await h.call(
      'retrospective_save',
      save(front('complete') + ASSESSED_SECTIONS),
    )
    expect(textOf(conforming)).toContain('policy rejected the retrospective:\n- policy says no')
    expect(requests).toEqual(['validateRetrospective'])
  })
})
