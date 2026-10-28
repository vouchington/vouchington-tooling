import { describe, expect, it } from 'vitest'

import { evaluateRunnerPolicy, formatRunnerPolicyViolation } from './evaluate.mts'
import type { RunnerPolicyConfig, WorkflowInput } from './types.mts'

const config = (overrides: Partial<RunnerPolicyConfig> = {}): RunnerPolicyConfig => ({
  allowedLabels: ['label-a', 'label-b'],
  requiredJobs: [],
  exactLabelJobs: [],
  restrictedLabels: [],
  ...overrides,
})

const workflow = (path: string, jobsYaml: string): WorkflowInput => ({
  path,
  text: `name: fixture\non: push\njobs:\n${jobsYaml}`,
})

const messages = (inputs: WorkflowInput[], cfg = config()): string[] =>
  evaluateRunnerPolicy(inputs, cfg).map(formatRunnerPolicyViolation)

describe('allowed runner labels', () => {
  it('accepts literal allowed labels and fully allowed matrices', () => {
    const input = workflow(
      'ok.yml',
      [
        '  plain:',
        '    runs-on: label-a',
        '  fanned:',
        '    runs-on: ${{ matrix.os }}',
        '    strategy:',
        '      matrix:',
        '        os: [label-a]',
        '        include:',
        '          - os: label-b',
        '  included-only:',
        '    runs-on: ${{matrix.runner}}',
        '    strategy:',
        '      matrix:',
        '        include:',
        '          - runner: label-b',
      ].join('\n'),
    )
    expect(messages([input])).toEqual([])
  })

  it.each([
    ['disallowed literal', '    runs-on: other', 'runs-on label "other" is not allowed'],
    ['missing runs-on', '    steps: []', 'runs-on is missing'],
    ['array label set', '    runs-on: [label-a, self-hosted]', 'runs-on must not be an array'],
    ['object form', '    runs-on:\n      group: pool', 'got object form'],
    ['number form', '    runs-on: 12', 'got number form'],
    ['computed expression', '    runs-on: ${{ inputs.runner }}', 'computed expression'],
    ['expression within a label', '    runs-on: x-${{ matrix.os }}', 'computed expression'],
    [
      'ternary expression',
      "    runs-on: ${{ cond && 'label-a' || 'label-b' }}",
      'computed expression',
    ],
  ])('rejects %s', (_name, runsOn, message) => {
    const [line] = messages([workflow('bad.yml', `  job:\n${runsOn}`)])
    expect(line).toContain('bad.yml#job')
    expect(line).toContain(message)
    expect(line).toContain('[allowed-labels]')
  })

  it.each([
    ['no strategy', ''],
    ['matrix is an expression', '    strategy:\n      matrix: ${{ fromJSON(inputs.m) }}\n'],
    ['matrix has no such field', '    strategy:\n      matrix:\n        other: [label-a]\n'],
    ['empty candidate array', '    strategy:\n      matrix:\n        os: []\n'],
    ['field is an expression', '    strategy:\n      matrix:\n        os: ${{ inputs.list }}\n'],
    ['include is an expression', '    strategy:\n      matrix:\n        include: ${{ x }}\n'],
  ])('rejects an unresolved matrix: %s', (_name, strategy) => {
    const [line] = messages([
      workflow('bad.yml', `  job:\n    runs-on: \${{ matrix.os }}\n${strategy}`),
    ])
    expect(line).toContain('[allowed-labels]')
    expect(line).toMatch(/matrix/)
  })

  it('rejects when any matrix candidate is disallowed', () => {
    const input = workflow(
      'bad.yml',
      [
        '  job:',
        '    runs-on: ${{ matrix.os }}',
        '    strategy:',
        '      matrix:',
        '        os: [label-a, bad-one, 7]',
        '        include:',
        '          - os: bad-two',
        '          - other: ignored',
        '          - not-a-mapping',
      ].join('\n'),
    )
    expect(messages([input])).toEqual([
      'bad.yml#job: runs-on label "bad-one" is not allowed [allowed-labels]',
      'bad.yml#job: runs-on label "7" is not allowed [allowed-labels]',
      'bad.yml#job: runs-on label "bad-two" is not allowed [allowed-labels]',
    ])
  })
})

describe('reusable-workflow delegates', () => {
  it('accepts delegates without runs-on and rejects those that set it', () => {
    const jobs = (extra: string): WorkflowInput =>
      workflow('call.yml', `  caller:\n    uses: ./.github/workflows/other.yml\n${extra}`)
    expect(messages([jobs('')])).toEqual([])
    expect(messages([jobs('    runs-on: label-a\n')])).toEqual([
      'call.yml#caller: reusable-workflow delegate must not set runs-on [reusable-delegate]',
    ])
  })
})

describe('required jobs', () => {
  const required = config({
    requiredJobs: [{ workflow: 'main.yml', job: 'gate', runsOn: 'label-a' }],
  })

  it('passes when the job exists with the literal label', () => {
    expect(messages([workflow('main.yml', '  gate:\n    runs-on: label-a')], required)).toEqual([])
  })

  it('reports a missing job, a wrong label and a matrix label', () => {
    expect(messages([workflow('main.yml', '  other:\n    runs-on: label-a')], required)).toEqual([
      'main.yml#gate: required job is missing [required-jobs]',
    ])
    expect(messages([workflow('main.yml', '  gate:\n    runs-on: label-b')], required)).toEqual([
      'main.yml#gate: required job must use literal runs-on "label-a" [required-jobs]',
    ])
    const matrix =
      '  gate:\n    runs-on: ${{ matrix.os }}\n    strategy:\n      matrix:\n        os: [label-a]'
    expect(messages([workflow('main.yml', matrix)], required)).toEqual([
      'main.yml#gate: required job must use literal runs-on "label-a" [required-jobs]',
    ])
  })

  it('reports a configured workflow that was not discovered', () => {
    expect(
      messages([workflow('unrelated.yml', '  gate:\n    runs-on: label-a')], required),
    ).toEqual(['main.yml: configured workflow "main.yml" was not discovered [required-jobs]'])
  })
})

describe('exact label job set', () => {
  const exact = config({
    allowedLabels: ['label-a', 'label-b', 'arm'],
    exactLabelJobs: [{ label: 'arm', jobs: ['a.yml#one', 'b.yml#two'] }],
  })
  const job = (id: string, label: string) => `  ${id}:\n    runs-on: ${label}`

  it('passes when the labelled set equals the configured set', () => {
    const inputs = [
      workflow('a.yml', `${job('one', 'arm')}\n${job('x', 'label-a')}`),
      workflow('b.yml', job('two', 'arm')),
    ]
    expect(messages(inputs, exact)).toEqual([])
  })

  it('reports missing and extra jobs, counting matrix candidates and skipping delegates', () => {
    const fanned =
      '  extra-matrix:\n    runs-on: ${{ matrix.os }}\n    strategy:\n      matrix:\n        os: [arm]'
    const delegate = '  delegate:\n    uses: ./.github/workflows/x.yml'
    const inputs = [
      workflow('a.yml', `${job('one', 'label-a')}\n${job('extra', 'arm')}\n${fanned}\n${delegate}`),
      workflow('b.yml', job('two', 'arm')),
    ]
    expect(messages(inputs, exact)).toEqual([
      'a.yml#one: expected to run on "arm" but does not [exact-label-jobs]',
      'a.yml#extra: runs on "arm" but is not in the exact set [exact-label-jobs]',
      'a.yml#extra-matrix: runs on "arm" but is not in the exact set [exact-label-jobs]',
    ])
  })

  it('reports configured workflows that are missing', () => {
    expect(messages([workflow('b.yml', job('two', 'arm'))], exact)).toEqual([
      'a.yml: configured workflow "a.yml" was not discovered [exact-label-jobs]',
      'a.yml#one: expected to run on "arm" but does not [exact-label-jobs]',
    ])
  })
})

describe('restricted label rules', () => {
  const restricted = config({
    restrictedLabels: [
      {
        label: 'label-a',
        forbidServices: true,
        forbiddenActions: { prefixes: ['pre/'], contains: ['/mid/'], exact: ['./local-action'] },
      },
    ],
  })

  it('passes jobs without services or forbidden actions, and other labels', () => {
    const jobs = [
      '  clean:',
      '    runs-on: label-a',
      '    services: {}',
      '    steps:',
      '      - run: echo',
      '      - uses: fine/action@v1',
      '  other:',
      '    runs-on: label-b',
      '    services:',
      '      db:',
      '        image: x',
      '    steps:',
      '      - uses: pre/anything@v1',
    ].join('\n')
    expect(messages([workflow('r.yml', jobs)], restricted)).toEqual([])
  })

  it('reports services and every forbidden action matcher kind', () => {
    const jobs = [
      '  bad:',
      '    runs-on: label-a',
      '    services:',
      '      db:',
      '        image: x',
      '    steps:',
      '      - uses: pre/thing@v1',
      '      - uses: org/mid/thing@v1',
      '      - uses: ./local-action',
      '      - uses: ./local-action-two',
    ].join('\n')
    expect(messages([workflow('r.yml', jobs)], restricted)).toEqual([
      'r.yml#bad: "label-a" jobs must not declare services [restricted-label]',
      'r.yml#bad: "label-a" jobs must not use action "pre/thing@v1" [restricted-label]',
      'r.yml#bad: "label-a" jobs must not use action "org/mid/thing@v1" [restricted-label]',
      'r.yml#bad: "label-a" jobs must not use action "./local-action" [restricted-label]',
    ])
  })

  it('treats expression and list services as non-empty and honours forbidServices false', () => {
    const job = (services: string) =>
      workflow('r.yml', `  j:\n    runs-on: label-a\n    services: ${services}\n    steps: bogus`)
    expect(messages([job('${{ x }}')], restricted)).toHaveLength(1)
    expect(messages([job('[a]')], restricted)).toHaveLength(1)
    expect(messages([job('[]')], restricted)).toEqual([])
    expect(messages([job('')], restricted)).toEqual([])
    const lenient = config({
      restrictedLabels: [
        {
          label: 'label-a',
          forbidServices: false,
          forbiddenActions: { prefixes: [], contains: [], exact: [] },
        },
      ],
    })
    expect(messages([job('${{ x }}')], lenient)).toEqual([])
  })

  it('only applies to literal labels and ignores delegates', () => {
    const jobs = [
      '  fanned:',
      '    runs-on: ${{ matrix.os }}',
      '    strategy:',
      '      matrix:',
      '        os: [label-a]',
      '    services:',
      '      db:',
      '        image: x',
      '  delegate:',
      '    uses: ./.github/workflows/x.yml',
    ].join('\n')
    expect(messages([workflow('r.yml', jobs)], restricted)).toEqual([])
  })
})

describe('fail closed', () => {
  it('reports empty discovery', () => {
    expect(messages([])).toEqual(['no workflow files were discovered [discovery]'])
  })

  it.each([
    ['invalid YAML', 'jobs: [unclosed', 'cannot parse YAML'],
    ['not a mapping', '- just\n- a list', 'workflow has no jobs mapping'],
    ['no jobs', 'name: x', 'workflow has no jobs mapping'],
    ['a non-mapping job', 'jobs:\n  bad: nope', 'job "bad" is not a mapping'],
  ])('reports %s as a parse violation', (_name, text, message) => {
    const [line] = messages([{ path: 'broken.yml', text }])
    expect(line).toContain(`broken.yml: ${message}`)
    expect(line).toContain('[parse]')
  })

  it('formats violations without a location', () => {
    expect(formatRunnerPolicyViolation({ policy: 'discovery', message: 'm' })).toBe('m [discovery]')
  })
})
