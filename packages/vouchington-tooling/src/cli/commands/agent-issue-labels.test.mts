import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ensureLabels = vi.hoisted(() =>
  vi.fn(async (options: { labels: string[] }) => options.labels),
)
vi.mock('../../agent-issue-labels/ensure-labels.mts', () => ({ ensureLabels }))

import type { ParsedAgentIssueLabels } from '../parse-agent-issue-labels.mts'
const { runAgentIssueLabels } = await import('./agent-issue-labels.mts')

describe('runAgentIssueLabels', () => {
  let dir: string
  let output: string[]

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-issue-labels-cli-'))
    output = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk))
      return true
    })
    ensureLabels.mockClear()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  it('prints labels matched by the default and an explicit labeler', async () => {
    const labeler = [
      'web:',
      '  - changed-files:',
      "      - any-glob-to-any-file: 'web/**'",
      '',
    ].join('\n')
    await writeFile(join(dir, 'custom.yml'), labeler)
    const parsed: ParsedAgentIssueLabels = {
      kind: 'agent-issue-labels',
      subcommand: 'labels-from-paths',
      paths: ['web/a.ts'],
    }
    expect(await runAgentIssueLabels(parsed, dir)).toBe(0)
    expect(output).toEqual([])
    expect(await runAgentIssueLabels({ ...parsed, labeler: 'custom.yml' }, dir)).toBe(0)
    expect(output).toEqual(['web\n'])
  })

  it('ensures labels with the policy file and repository', async () => {
    await writeFile(join(dir, 'policy.json'), JSON.stringify({ defaultColor: '111111' }))
    const base: ParsedAgentIssueLabels = {
      kind: 'agent-issue-labels',
      subcommand: 'ensure-labels',
      update: false,
      labels: ['a', 'b'],
    }
    expect(await runAgentIssueLabels(base, dir)).toBe(0)
    expect(ensureLabels).toHaveBeenLastCalledWith({ labels: ['a', 'b'], update: false })
    expect(output).toEqual(['a\n', 'b\n'])
    await runAgentIssueLabels(
      { ...base, repo: 'o/r', policyFile: 'policy.json', update: true },
      dir,
    )
    expect(ensureLabels).toHaveBeenLastCalledWith({
      labels: ['a', 'b'],
      update: true,
      repo: 'o/r',
      policy: expect.objectContaining({ defaultColor: '111111' }),
    })
  })
})
