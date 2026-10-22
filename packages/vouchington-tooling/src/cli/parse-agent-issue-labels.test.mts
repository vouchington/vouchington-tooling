import { describe, expect, it } from 'vitest'
import { parseAgentIssueLabels } from './parse-agent-issue-labels.mts'
import { parseCli } from './parse.mts'

describe('parseAgentIssueLabels', () => {
  it('parses labels-from-paths with and without --labeler', () => {
    expect(parseAgentIssueLabels(['labels-from-paths', 'a.ts', 'b.ts'])).toEqual({
      kind: 'agent-issue-labels',
      subcommand: 'labels-from-paths',
      paths: ['a.ts', 'b.ts'],
    })
    expect(
      parseCli(['node', 'v', 'agent-issue-labels', 'labels-from-paths', '--labeler', 'l.yml', 'a']),
    ).toEqual({
      kind: 'agent-issue-labels',
      subcommand: 'labels-from-paths',
      labeler: 'l.yml',
      paths: ['a'],
    })
  })

  it('parses ensure-labels options', () => {
    expect(
      parseAgentIssueLabels([
        'ensure-labels',
        '--repo',
        'o/r',
        'one',
        '--update',
        '--policy-file',
        'p.json',
        'two',
      ]),
    ).toEqual({
      kind: 'agent-issue-labels',
      subcommand: 'ensure-labels',
      repo: 'o/r',
      policyFile: 'p.json',
      update: true,
      labels: ['one', 'two'],
    })
    expect(parseAgentIssueLabels(['ensure-labels', 'one'])).toEqual({
      kind: 'agent-issue-labels',
      subcommand: 'ensure-labels',
      update: false,
      labels: ['one'],
    })
  })

  it.each([
    [[], 'agent-issue-labels requires labels-from-paths or ensure-labels'],
    [['bogus'], 'unknown agent-issue-labels subcommand: bogus'],
    [['ensure-labels'], 'agent-issue-labels ensure-labels requires at least one label'],
    [['ensure-labels', '--repo'], 'agent-issue-labels: --repo requires a value'],
    [['ensure-labels', '--repo', '--update', 'x'], 'agent-issue-labels: --repo requires a value'],
    [['ensure-labels', '--repo', 'a/b', '--repo', 'c/d', 'x'], '--repo may be specified only once'],
    [['ensure-labels', '--update', '--update', 'x'], '--update may be specified only once'],
    [['ensure-labels', '--labeler', 'x', 'y'], 'unknown agent-issue-labels option: --labeler'],
    [['labels-from-paths', '--update', 'x'], 'unknown agent-issue-labels option: --update'],
    [['labels-from-paths', '--wat'], 'unknown agent-issue-labels option: --wat'],
  ])('rejects invalid arguments %#', (args, message) => {
    const result = parseAgentIssueLabels(args)
    expect(result.kind).toBe('error')
    expect(result).toMatchObject({ message: expect.stringContaining(message) })
  })
})
