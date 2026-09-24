import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  cleanupTemporaryDirectories,
  runHelper,
} from './gha-download-optional-run-artifacts.test-helpers.mts'

// Records every gh call in "$GITHUB_OUTPUT.calls"; the listing and one optional failing
// download come from the environment so artifact names never pass through shell quoting.
const fakeGh = `#!/bin/sh
if [ "$1" = api ]; then
  printf 'api\\n' >> "$GITHUB_OUTPUT.calls"
  printf '%s\\n' "$FAKE_GH_LISTING"
  exit 0
fi
name=''; dir=''
while [ "$#" -gt 0 ]; do
  case "$1" in --name) name="$2"; shift 2;; --dir) dir="$2"; shift 2;; *) shift;; esac
done
printf 'download %s\\n' "$name" >> "$GITHUB_OUTPUT.calls"
if [ "$name" = "$FAKE_GH_FAIL_NAME" ]; then echo 'HTTP 500 while downloading' >&2; exit "$FAKE_GH_FAIL_STATUS"; fi
mkdir -p "$dir"
printf '%s\\n' "$name" > "$dir/artifact-name"
`

type Scenario = {
  readonly names: readonly string[]
  readonly listing: readonly string[]
  readonly fail?: { readonly name: string; readonly status: number }
}

function runNames({ names, listing, fail }: Scenario) {
  return runHelper({
    args: (temporaryDirectory) => [
      ...names.flatMap((name) => ['--name', name]),
      '--dir',
      join(temporaryDirectory, 'out'),
    ],
    env: {
      FAKE_GH_LISTING: listing.join('\n'),
      FAKE_GH_FAIL_NAME: fail?.name ?? '',
      FAKE_GH_FAIL_STATUS: String(fail?.status ?? 0),
    },
    ghScript: fakeGh,
  })
}

type Result = ReturnType<typeof runHelper>

function calls(result: Result) {
  const file = join(result.temporaryDirectory, 'github-output.calls')
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').slice(0, -1) : []
}

function warnings(result: Result) {
  return result.stderr.split('\n').filter((line) => line.includes('::warning::'))
}

function notices(result: Result) {
  return result.stderr.split('\n').filter((line) => line.includes('::notice::'))
}

function downloaded(result: Result, name: string) {
  return readFileSync(join(result.temporaryDirectory, 'out', name, 'artifact-name'), 'utf8')
}

describe('download-optional-run-artifacts --name', () => {
  afterEach(cleanupTemporaryDirectories)

  it('lists the run once and downloads exactly the requested names in request order', () => {
    const result = runNames({ names: ['c', 'a', 'b'], listing: ['b', 'unrequested', 'a', 'c'] })

    expect(result.status).toBe(0)
    expect(calls(result)).toEqual(['api', 'download c', 'download a', 'download b'])
    expect(['a', 'b', 'c'].map((name) => downloaded(result, name))).toEqual(['a\n', 'b\n', 'c\n'])
    expect(warnings(result)).toEqual([])
    expect(result.stderr).toContain(
      '[optional-run-artifacts] selection selector=name requested=3 present=3 absent=0',
    )
    expect(result.stderr).toContain('[optional-run-artifacts] result=available selector=name')
    expect(result.output).toBe('availability=available\n')
  })

  it('extracts a single name into its own directory like every other name', () => {
    const result = runNames({ names: ['only'], listing: ['only'] })

    expect(result.status).toBe(0)
    expect(downloaded(result, 'only')).toBe('only\n')
    expect(result.output).toBe('availability=available\n')
  })

  it('downloads the present names and notices once about the absent ones', () => {
    const result = runNames({
      names: ['present-a', 'missing-a', 'present-b', 'missing-b', 'missing-c'],
      listing: ['present-b', 'present-a'],
    })

    expect(result.status).toBe(0)
    expect(calls(result)).toEqual(['api', 'download present-a', 'download present-b'])
    expect(notices(result)).toEqual([
      '::notice::Optional same-run artifacts absent: 3 of 5 requested (missing-a, missing-b, missing-c)',
    ])
    expect(warnings(result)).toEqual([])
    expect(result.output).toBe('availability=available\n')
  })

  it('bounds the absent notice to a count and the first few names', () => {
    const absent = Array.from(
      { length: 40 },
      (_, index) => `missing-${String(index + 1).padStart(2, '0')}`,
    )
    const result = runNames({ names: ['present', ...absent], listing: ['present'] })

    expect(result.status).toBe(0)
    expect(notices(result)).toEqual([
      '::notice::Optional same-run artifacts absent: 40 of 41 requested (missing-01, missing-02, missing-03 and 37 more)',
    ])
    expect(warnings(result)).toEqual([])
    expect(result.stderr.match(/missing-\d+/g)).toHaveLength(3)
    expect(result.output).toBe('availability=available\n')
  })

  it('reports availability=unavailable with one notice when every name is absent', () => {
    const result = runNames({ names: ['missing-a', 'missing-b'], listing: ['other'] })

    expect(result.status).toBe(0)
    expect(calls(result)).toEqual(['api'])
    expect(notices(result)).toEqual([
      '::notice::Optional same-run artifacts absent: 2 of 2 requested (missing-a, missing-b)',
    ])
    expect(warnings(result)).toEqual([])
    expect(result.stderr).toContain(
      '[optional-run-artifacts] result=unavailable selector=name exit=3',
    )
    expect(result.output).toBe('availability=unavailable\n')
  })

  it('treats an empty listing as every name being absent', () => {
    const result = runNames({ names: ['missing'], listing: [] })

    expect(result.status).toBe(0)
    expect(notices(result)).toHaveLength(1)
    expect(warnings(result)).toEqual([])
    expect(result.output).toBe('availability=unavailable\n')
  })

  it('fails hard, naming the artifact, when a present download fails', () => {
    const result = runNames({
      names: ['a', 'b', 'c'],
      listing: ['a', 'b', 'c'],
      fail: { name: 'b', status: 1 },
    })

    expect(result.status).toBe(1)
    expect(calls(result)).toEqual(['api', 'download a', 'download b'])
    expect(result.stderr).toContain('HTTP 500 while downloading')
    expect(result.stderr).toContain('[optional-run-artifacts] download failed artifact=b exit=1')
    expect(result.stderr).toContain('[optional-run-artifacts] result=error selector=name exit=1')
    expect(result.stderr).not.toContain('::error::')
    expect(warnings(result)).toEqual([])
    expect(result.output).toBe('')
  })

  it('keeps a failing download hard when absent names were also requested', () => {
    const result = runNames({
      names: ['a', 'missing'],
      listing: ['a'],
      fail: { name: 'a', status: 1 },
    })

    expect(result.status).toBe(1)
    expect(notices(result)).toHaveLength(1)
    expect(warnings(result)).toEqual([])
    expect(result.stderr).toContain('[optional-run-artifacts] download failed artifact=a exit=1')
    expect(result.output).toBe('')
  })

  it('never mistakes a downloader exit code of 3 for an absent artifact', () => {
    const result = runNames({ names: ['a'], listing: ['a'], fail: { name: 'a', status: 3 } })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[optional-run-artifacts] download failed artifact=a exit=3')
    expect(result.stderr).not.toContain('result=unavailable')
    expect(warnings(result)).toEqual([])
    expect(result.output).toBe('')
  })

  it('fails without downloading when the listing keeps failing', () => {
    const result = runHelper({
      args: (temporaryDirectory) => [
        '--name',
        'a',
        '--name',
        'b',
        '--dir',
        join(temporaryDirectory, 'out'),
      ],
      ghScript: `#!/bin/sh
if [ "$1" = api ]; then printf 'api\\n' >> "$GITHUB_OUTPUT.calls"; echo 'TLS handshake timeout' >&2; exit 71; fi
exit 99
`,
      sleepScript: '#!/bin/sh\nexit 0\n',
    })

    expect(result.status).toBe(71)
    expect(calls(result)).toEqual(['api', 'api', 'api'])
    expect(result.stderr).toContain('[optional-run-artifacts] result=error selector=name exit=71')
    expect(result.output).toBe('')
  })

  it('downloads each repeated name once and counts it once', () => {
    const result = runNames({ names: ['a', 'b', 'a', 'missing', 'missing'], listing: ['a', 'b'] })

    expect(result.status).toBe(0)
    expect(calls(result)).toEqual(['api', 'download a', 'download b'])
    expect(notices(result)).toEqual([
      '::notice::Optional same-run artifacts absent: 1 of 3 requested (missing)',
    ])
    expect(warnings(result)).toEqual([])
  })

  it('accepts --dir before, between, and after --name flags', () => {
    const result = runHelper({
      args: (temporaryDirectory) => [
        '--name',
        'a',
        '--dir',
        join(temporaryDirectory, 'out'),
        '--name',
        'b',
      ],
      env: { FAKE_GH_LISTING: 'a\nb' },
      ghScript: fakeGh,
    })

    expect(result.status).toBe(0)
    expect(calls(result)).toEqual(['api', 'download a', 'download b'])
  })

  const oddNames = [
    'coverage *',
    '*',
    'a?b',
    '[abc]',
    '$(printf expanded)',
    '`printf tick`',
    "it's",
    'λinux ünï',
    '-leading-dash',
    '--pattern',
    '100%',
    'two  spaces',
  ]

  it('downloads odd artifact names literally without splitting, globbing, or expansion', () => {
    const result = runNames({ names: oddNames, listing: [...oddNames, 'abc', 'a b'].reverse() })

    expect(result.status).toBe(0)
    expect(calls(result)).toEqual(['api', ...oddNames.map((name) => `download ${name}`)])
    expect(oddNames.map((name) => downloaded(result, name))).toEqual(
      oddNames.map((name) => `${name}\n`),
    )
    expect(warnings(result)).toEqual([])
  })

  it('does not treat requested names as patterns or word lists', () => {
    const result = runNames({
      names: ['*', 'a*', 'a?c', '[a]bc', 'a b'],
      listing: ['abc', 'alpha', 'a', 'b'],
    })

    expect(result.status).toBe(0)
    expect(calls(result)).toEqual(['api'])
    expect(notices(result)).toEqual([
      '::notice::Optional same-run artifacts absent: 5 of 5 requested (*, a*, a?c and 2 more)',
    ])
    expect(warnings(result)).toEqual([])
    expect(result.output).toBe('availability=unavailable\n')
  })

  it('escapes percent signs so an absent name cannot forge a workflow-command escape', () => {
    const result = runNames({ names: ['50%0A'], listing: [] })

    expect(notices(result)).toEqual([
      '::notice::Optional same-run artifacts absent: 1 of 1 requested (50%250A)',
    ])
    expect(warnings(result)).toEqual([])
  })

  it.each(['.', '..', 'nested/name', 'back\\slash', 'line\nbreak', 'carriage\rreturn'])(
    'rejects unsafe name %j before listing anything',
    (unsafe) => {
      const result = runNames({ names: ['good', unsafe], listing: ['good'] })

      expect(result.status).toBe(2)
      expect(result.stderr).toContain('[optional-run-artifacts] invalid artifact name')
      expect(result.stderr).toContain('[optional-run-artifacts] result=error selector=name exit=2')
      expect(calls(result)).toEqual([])
      expect(result.output).toBe('')
    },
  )

  it.each([
    { label: 'name then pattern', args: ['--name', 'a', '--pattern', 'b', '--dir', 'out'] },
    { label: 'pattern then name', args: ['--pattern', 'b', '--name', 'a', '--dir', 'out'] },
    { label: 'no selector', args: ['--dir', 'out'] },
    { label: 'no directory', args: ['--name', 'a', '--name', 'b'] },
    { label: 'name without a value', args: ['--dir', 'out', '--name'] },
    { label: 'empty name', args: ['--name', '', '--dir', 'out'] },
    { label: 'repeated directory', args: ['--name', 'a', '--dir', 'out', '--dir', 'other'] },
    { label: 'repeated pattern', args: ['--pattern', 'a', '--pattern', 'b', '--dir', 'out'] },
    { label: 'unknown flag', args: ['--name', 'a', '--dir', 'out', '--unexpected'] },
  ])('rejects $label as a usage error without calling gh', ({ args }) => {
    const result = runHelper({ args, env: { FAKE_GH_LISTING: 'a' }, ghScript: fakeGh })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage:')
    expect(calls(result)).toEqual([])
    expect(result.output).toBe('')
  })

  it('documents the repeatable --name flag in the usage text', () => {
    const result = runHelper({ args: [] })

    expect(result.stderr).toContain(
      'usage: download-optional-run-artifacts.sh (--name <name>... | --pattern <pattern>) --dir <directory>',
    )
  })
})
