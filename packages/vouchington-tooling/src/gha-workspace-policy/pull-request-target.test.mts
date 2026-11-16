import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildContextFromTrackedFiles } from '../shared-context/index.mts'
import { checkGhaWorkspacePolicy } from './index.mts'

describe('GitHub Actions pull_request_target policy', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
  })

  async function check(files: Record<string, string>): Promise<string[]> {
    const root = await mkdtemp(join(tmpdir(), 'gha-pull-request-target-'))
    roots.push(root)
    for (const [file, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true })
      await writeFile(join(root, file), content)
    }
    return (await checkGhaWorkspacePolicy(buildContextFromTrackedFiles(root, Object.keys(files))))
      .errors
  }

  const jobs = 'jobs:\n  x:\n    runs-on: ubuntu-slim\n    steps:\n      - run: "true"\n'

  it.each([
    ['a string', 'on: pull_request_target\n'],
    ['a list', 'on: [push, pull_request_target]\n'],
    ['a map', 'on:\n  pull_request_target:\n    types: [dequeued]\n'],
    ['a map with a null value', 'on:\n  push:\n  pull_request_target:\n'],
  ])('rejects pull_request_target given as %s', async (_shape, on) => {
    expect(await check({ '.github/workflows/w.yml': `${on}${jobs}` })).toEqual([
      expect.stringMatching(
        /^::error file=\.github\/workflows\/w\.yml::.*triggers on pull_request_target\..*pull_request instead\.$/u,
      ),
    ])
  })

  it.each([
    ['pull_request', 'on:\n  pull_request:\n    types: [dequeued]\n'],
    ['a list without it', 'on: [push, pull_request]\n'],
    ['workflow_call', 'on:\n  workflow_call:\n'],
    ['no trigger', ''],
    ['a non-string list entry', 'on: [push, 1]\n'],
  ])('allows %s', async (_shape, on) => {
    expect(await check({ '.github/workflows/w.yml': `${on}${jobs}` })).toEqual([])
  })

  it('checks workflows only, not composite actions or YAML that is not a mapping', async () => {
    expect(
      await check({
        '.github/actions/a/action.yml':
          'name: a\non: pull_request_target\nruns:\n  using: composite\n  steps: []\n',
        '.github/workflows/list.yml': '- pull_request_target\n',
      }),
    ).toEqual([])
  })
})
