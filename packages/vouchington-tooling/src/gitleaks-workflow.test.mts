import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

interface Step {
  id?: string
  name?: string
  run?: string
  uses?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
  if?: string
  'timeout-minutes'?: number
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const source = readFileSync(join(root, '.github/workflows/gitleaks.yml'), 'utf8')
const workflow = load(source) as {
  on: { workflow_call: { inputs: Record<string, { default?: string }> } }
  jobs: { gitleaks: { 'timeout-minutes': number; steps: Step[] } }
}
const steps = workflow.jobs.gitleaks.steps

function step(name: string) {
  const found = steps.find((candidate) => candidate.name === name)
  if (!found?.run) throw new Error(`missing step ${name}`)
  return found
}

function runRange(env: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'gitleaks-range-'))
  const bin = join(directory, 'bin')
  const output = join(directory, 'output')
  const fetchLog = join(directory, 'fetch-log')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'git'),
    `#!/bin/bash
if [ "$1" = fetch ]; then printf '%s\\n' "$*" >> "$GIT_FETCH_LOG"; exit 0; fi
if [ "$1" = rev-list ]; then printf '%s\n' "$GIT_COUNT"; exit 0; fi
echo "unexpected git $*" >&2
exit 1
`,
  )
  chmodSync(join(bin, 'git'), 0o755)
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/bash
printf 'api %s\n' "$2" >> "$GIT_FETCH_LOG"
printf '%b\n' "$GH_OUT"
`,
  )
  chmodSync(join(bin, 'gh'), 0o755)
  try {
    const result = spawnSync(
      'bash',
      [
        '--noprofile',
        '--norc',
        '-eo',
        'pipefail',
        '-c',
        step('Determine Gitleaks scan range').run ?? '',
      ],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: output,
          GIT_FETCH_LOG: fetchLog,
          GH_TOKEN: 'test-token',
          GITHUB_REPOSITORY: 'owner/repo',
          GH_OUT: `${'e'.repeat(40)}\t2`,
          GIT_COUNT: '2',
          ...env,
        },
      },
    )
    const written = result.status === 0 ? readFileSync(output, 'utf8') : ''
    return {
      fetchCalls: existsSync(fetchLog) ? readFileSync(fetchLog, 'utf8') : '',
      status: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
      written,
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 10_000 })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

function createSyntheticRemote() {
  const directory = mkdtempSync(join(tmpdir(), 'gitleaks-history-'))
  const sourceRepo = join(directory, 'source')
  const remote = join(directory, 'remote.git')
  mkdirSync(sourceRepo)
  git(sourceRepo, 'init', '--quiet', '--initial-branch=main')
  git(sourceRepo, 'config', 'user.name', 'Gitleaks workflow test')
  git(sourceRepo, 'config', 'user.email', 'gitleaks-workflow@example.invalid')
  writeFileSync(join(sourceRepo, 'common.txt'), 'SYNTHETIC_FAKE_SECRET_COMMON\n')
  git(sourceRepo, 'add', 'common.txt')
  git(sourceRepo, 'commit', '--quiet', '-m', 'common')
  writeFileSync(join(sourceRepo, 'base.txt'), 'base\n')
  git(sourceRepo, 'add', 'base.txt')
  git(sourceRepo, 'commit', '--quiet', '-m', 'base')
  const baseSha = git(sourceRepo, 'rev-parse', 'HEAD')

  git(sourceRepo, 'switch', '--quiet', '-c', 'pull-head')
  writeFileSync(join(sourceRepo, 'pr.txt'), 'SYNTHETIC_FAKE_SECRET_PR\n')
  writeFileSync(join(sourceRepo, 'pr-history-only.txt'), 'SYNTHETIC_FAKE_SECRET_REMOVED_AT_HEAD\n')
  git(sourceRepo, 'add', 'pr.txt', 'pr-history-only.txt')
  git(sourceRepo, 'commit', '--quiet', '-m', 'add PR markers')
  const historicalMarkerSha = git(sourceRepo, 'rev-parse', 'HEAD')
  rmSync(join(sourceRepo, 'pr-history-only.txt'))
  git(sourceRepo, 'add', '-u', 'pr-history-only.txt')
  git(sourceRepo, 'commit', '--quiet', '-m', 'remove historical-only marker')
  const headSha = git(sourceRepo, 'rev-parse', 'HEAD')

  git(sourceRepo, 'switch', '--quiet', 'main')
  writeFileSync(join(sourceRepo, 'advanced.txt'), 'advanced base\n')
  git(sourceRepo, 'add', 'advanced.txt')
  git(sourceRepo, 'commit', '--quiet', '-m', 'advance PR base')
  const advancedBaseSha = git(sourceRepo, 'rev-parse', 'HEAD')
  git(sourceRepo, 'merge', '--quiet', '--no-ff', 'pull-head', '-m', 'synthetic PR merge')
  const mergeSha = git(sourceRepo, 'rev-parse', 'HEAD')

  git(sourceRepo, 'switch', '--quiet', '-c', 'merge-group-head', advancedBaseSha)
  writeFileSync(join(sourceRepo, 'merge-group.txt'), 'SYNTHETIC_FAKE_SECRET_MERGE_GROUP\n')
  git(sourceRepo, 'add', 'merge-group.txt')
  git(sourceRepo, 'commit', '--quiet', '-m', 'merge group head')
  const mergeGroupHeadSha = git(sourceRepo, 'rev-parse', 'HEAD')

  git(sourceRepo, 'switch', '--quiet', '-c', 'distractor', mergeSha)
  writeFileSync(join(sourceRepo, 'distractor.txt'), 'SYNTHETIC_FAKE_SECRET_DISTRACTOR\n')
  git(sourceRepo, 'add', 'distractor.txt')
  git(sourceRepo, 'commit', '--quiet', '-m', 'unrelated branch')
  const distractorSha = git(sourceRepo, 'rev-parse', 'HEAD')

  git(sourceRepo, 'switch', '--quiet', '--orphan', 'tag-only')
  writeFileSync(join(sourceRepo, 'tag-only.txt'), 'SYNTHETIC_FAKE_SECRET_TAG_ONLY\n')
  git(sourceRepo, 'add', 'tag-only.txt')
  git(sourceRepo, 'commit', '--quiet', '-m', 'tag-only history')
  const tagOnlySha = git(sourceRepo, 'rev-parse', 'HEAD')
  git(sourceRepo, 'tag', 'synthetic-tag', tagOnlySha)

  git(directory, 'init', '--bare', '--quiet', remote)
  git(sourceRepo, 'remote', 'add', 'origin', remote)
  git(
    sourceRepo,
    'push',
    '--quiet',
    'origin',
    'main',
    'pull-head',
    'distractor',
    'merge-group-head',
  )
  git(sourceRepo, 'push', '--quiet', 'origin', `${mergeSha}:refs/pull/7/merge`)
  git(sourceRepo, 'push', '--quiet', 'origin', '--tags')

  return {
    advancedBaseSha,
    baseSha,
    directory,
    distractorSha,
    headSha,
    historicalMarkerSha,
    mergeGroupHeadSha,
    mergeSha,
    remote,
    sourceRepo,
    tagOnlySha,
  }
}

function shallowClient(remote: string, directory: string, refspec: string, ref: string) {
  mkdirSync(directory)
  git(directory, 'init', '--quiet')
  git(directory, 'remote', 'add', 'origin', remote)
  git(directory, 'fetch', '--quiet', '--depth=1', 'origin', refspec)
  git(directory, 'checkout', '--quiet', '--detach', ref)
}

let ghStubDir = ''

function writeGhStub(directory: string, sourceRepo: string) {
  ghStubDir = join(directory, 'gh-bin')
  mkdirSync(ghStubDir)
  writeFileSync(
    join(ghStubDir, 'gh'),
    `#!/bin/bash
range="\${2##*/compare/}"
base="\${range%%...*}"
head="\${range##*...}"
mb=$(git -C '${sourceRepo}' merge-base "$base" "$head")
n=$(git -C '${sourceRepo}' rev-list --count "$mb..$head")
printf '%s\t%s\n' "$mb" "$n"
`,
  )
  chmodSync(join(ghStubDir, 'gh'), 0o755)
}

function runActualRange(directory: string, env: Record<string, string>) {
  const output = join(directory, 'range-output')
  const result = spawnSync(
    'bash',
    [
      '--noprofile',
      '--norc',
      '-eo',
      'pipefail',
      '-c',
      step('Determine Gitleaks scan range').run ?? '',
    ],
    {
      encoding: 'utf8',
      cwd: directory,
      timeout: 30_000,
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        GH_TOKEN: 'test-token',
        GITHUB_REPOSITORY: 'owner/repo',
        PATH: `${ghStubDir}:${process.env.PATH ?? ''}`,
        ...env,
      },
    },
  )
  return {
    stderr: result.stderr,
    status: result.status,
    stdout: result.stdout,
    written: result.status === 0 ? readFileSync(output, 'utf8') : '',
  }
}

describe('gitleaks git reusable workflow', () => {
  it('takes a version and config and stays distinct from the directory scan', () => {
    expect(workflow.on.workflow_call.inputs.version?.default).toBe('8.30.1')
    expect(workflow.on.workflow_call.inputs.config?.default).toBe('.gitleaks.toml')
    expect(step('Scan git history').run).toContain('gitleaks git')
    expect(step('Scan git history').run).not.toContain('gitleaks dir')
    expect(source).not.toMatch(/voucha|filament|storybook|vouchington-machines/iu)
    expect(step('Install gitleaks').env?.GITLEAKS_VERSION).toBe('${{ inputs.version }}')
    expect(step('Install gitleaks').run).toContain(
      '.vouchington-tooling-checkout/packages/vouchington-tooling/scripts/gha/install-github-release.sh',
    )
    expect(step('Install gitleaks').run).toContain('--repo gitleaks/gitleaks')
    expect(step('Install gitleaks').run).toContain('--bin-dir "$RUNNER_TEMP/bin"')
    expect(step('Scan git history').env?.GITLEAKS_CONFIG).toBe('${{ inputs.config }}')
    const upload = steps.find((candidate) => candidate.name === 'Upload redacted gitleaks report')
    expect(upload?.if).toBe('${{ failure() }}')
    expect(upload?.uses).toBe('actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9')
  })

  it('bounds the history fetch with the compare API and never unshallows', () => {
    const script = step('Determine Gitleaks scan range').run ?? ''
    expect(script).not.toContain('--unshallow')
    expect(script).toContain('gh api "repos/$GITHUB_REPOSITORY/compare/$BASE_SHA...$HEAD_SHA"')
    expect(script).toContain("--jq '[.merge_base_commit.sha, .ahead_by] | @tsv'")
    expect(script).toContain('--depth=$((AHEAD_BY + 1)) origin "$HEAD_SHA"')
    expect(script).toContain('--depth=1 origin "$MERGE_BASE" "$BASE_SHA"')
    expect(script).toContain('git rev-list --count "$LOG_OPTS"')
    expect(script).not.toContain('git merge-base')
    const base = 'a'.repeat(40)
    const head = 'b'.repeat(40)
    const pr = runRange({
      EVENT_NAME: 'pull_request',
      PR_BASE_SHA: base,
      PR_HEAD_SHA: head,
      MERGE_GROUP_BASE_SHA: '',
      MERGE_GROUP_HEAD_SHA: '',
      GH_OUT: `${'e'.repeat(40)}\t4`,
      GIT_COUNT: '4',
    })
    expect(pr.status, pr.stderr).toBe(0)
    expect(pr.fetchCalls).toContain(`api repos/owner/repo/compare/${base}...${head}`)
    expect(pr.fetchCalls).toContain(`fetch --no-tags --depth=5 origin ${head}`)
    expect(pr.fetchCalls).toContain(`fetch --no-tags --depth=1 origin ${'e'.repeat(40)} ${base}`)
  })

  it.each([
    ['a non-OID merge base', 'nothex\t2'],
    ['a negative ahead_by', `${'e'.repeat(40)}\t-1`],
    ['a missing ahead_by', 'e'.repeat(40)],
  ])('rejects %s from the compare API before fetching history', (_name, out) => {
    const result = runRange({
      EVENT_NAME: 'pull_request',
      PR_BASE_SHA: 'a'.repeat(40),
      PR_HEAD_SHA: 'b'.repeat(40),
      MERGE_GROUP_BASE_SHA: '',
      MERGE_GROUP_HEAD_SHA: '',
      GH_OUT: out,
    })
    expect(result.status).toBe(2)
    expect(result.stdout).toContain('::error::Compare API returned')
    expect(result.fetchCalls).not.toContain('fetch')
  })

  it('fails when the fetched range does not match ahead_by', () => {
    const result = runRange({
      EVENT_NAME: 'merge_group',
      PR_BASE_SHA: '',
      PR_HEAD_SHA: '',
      MERGE_GROUP_BASE_SHA: 'c'.repeat(40),
      MERGE_GROUP_HEAD_SHA: 'd'.repeat(40),
      GIT_COUNT: '1',
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('::error::Fetched range has 1 commits but compare reports 2')
  })

  it('checks out the tooling repository at the called workflow sha', () => {
    expect(source).not.toContain('workflow_ref')
    const tooling = steps.find((candidate) => candidate.name === 'Checkout tooling scripts')
    expect(tooling?.with).toMatchObject({
      repository: '${{ job.workflow_repository }}',
      ref: '${{ job.workflow_sha }}',
      'persist-credentials': false,
    })
    expect(steps[0]?.with?.['fetch-depth']).toBe(
      "${{ github.event_name == 'workflow_dispatch' && '0' || '1' }}",
    )
    expect(steps[0]?.with?.['persist-credentials']).toBe(false)
    expect(step('Determine Gitleaks scan range').env?.GH_TOKEN).toBe('${{ github.token }}')
    expect(step('Determine Gitleaks scan range')['timeout-minutes']).toBe(5)
    expect(tooling?.['timeout-minutes']).toBe(2)
    expect(workflow.jobs.gitleaks['timeout-minutes']).toBe(12)
    const stepTotal = steps.reduce((sum, candidate) => sum + (candidate['timeout-minutes'] ?? 0), 0)
    expect(workflow.jobs.gitleaks['timeout-minutes']).toBeLessThan(stepTotal)
  })

  it('scans the pull request merge base, the merge group range, or all history', () => {
    const pullRequest = runRange({
      EVENT_NAME: 'pull_request',
      PR_BASE_SHA: 'a'.repeat(40),
      PR_HEAD_SHA: 'b'.repeat(40),
      MERGE_GROUP_BASE_SHA: '',
      MERGE_GROUP_HEAD_SHA: '',
    })
    expect(pullRequest.written).toBe(`log-opts=${'e'.repeat(40)}..${'b'.repeat(40)}\n`)
    expect(pullRequest.fetchCalls).not.toBe('')
    const mergeGroup = runRange({
      EVENT_NAME: 'merge_group',
      PR_BASE_SHA: '',
      PR_HEAD_SHA: '',
      MERGE_GROUP_BASE_SHA: 'c'.repeat(40),
      MERGE_GROUP_HEAD_SHA: 'd'.repeat(40),
    })
    expect(mergeGroup.written).toBe(`log-opts=${'c'.repeat(40)}..${'d'.repeat(40)}\n`)
    expect(mergeGroup.fetchCalls).not.toBe('')
    const dispatch = runRange({
      EVENT_NAME: 'workflow_dispatch',
      PR_BASE_SHA: '',
      PR_HEAD_SHA: '',
      MERGE_GROUP_BASE_SHA: '',
      MERGE_GROUP_HEAD_SHA: '',
    })
    expect(dispatch.written).toBe('log-opts=--all\n')
    expect(dispatch.fetchCalls).toBe('')
    expect(
      runRange({
        EVENT_NAME: 'push',
        PR_BASE_SHA: '',
        PR_HEAD_SHA: '',
        MERGE_GROUP_BASE_SHA: '',
        MERGE_GROUP_HEAD_SHA: '',
      }).status,
    ).toBe(1)
  })

  it('fetches exact PR and merge-group OIDs with full event-range object parity', () => {
    const fixture = createSyntheticRemote()
    writeGhStub(fixture.directory, fixture.sourceRepo)
    try {
      const prClient = join(fixture.directory, 'pr-client')
      shallowClient(
        fixture.remote,
        prClient,
        '+refs/pull/7/merge:refs/remotes/pull/7/merge',
        'refs/remotes/pull/7/merge',
      )
      expect(git(prClient, 'rev-parse', 'HEAD')).toBe(fixture.mergeSha)
      const pr = runActualRange(prClient, {
        EVENT_NAME: 'pull_request',
        PR_BASE_SHA: fixture.advancedBaseSha,
        PR_HEAD_SHA: fixture.headSha,
        MERGE_GROUP_BASE_SHA: '',
        MERGE_GROUP_HEAD_SHA: '',
      })
      expect(pr.status, pr.stderr).toBe(0)
      expect(pr.written).toBe(`log-opts=${fixture.baseSha}..${fixture.headSha}\n`)
      const prRange = `${fixture.baseSha}..${fixture.headSha}`
      expect(git(prClient, 'rev-list', prRange)).toBe(git(fixture.sourceRepo, 'rev-list', prRange))
      expect(git(prClient, 'rev-list', '--objects', prRange).split('\n').sort()).toEqual(
        git(fixture.sourceRepo, 'rev-list', '--objects', prRange).split('\n').sort(),
      )
      expect(git(prClient, 'show', `${fixture.historicalMarkerSha}:pr-history-only.txt`)).toContain(
        'SYNTHETIC_FAKE_SECRET_REMOVED_AT_HEAD',
      )
      expect(
        spawnSync(
          'git',
          ['-C', prClient, 'cat-file', '-e', `${fixture.headSha}:pr-history-only.txt`],
          { timeout: 10_000 },
        ).status,
      ).not.toBe(0)
      for (const sha of [fixture.distractorSha, fixture.tagOnlySha]) {
        expect(
          spawnSync('git', ['-C', prClient, 'cat-file', '-e', `${sha}^{commit}`], {
            timeout: 10_000,
          }).status,
        ).not.toBe(0)
      }

      const groupClient = join(fixture.directory, 'group-client')
      shallowClient(
        fixture.remote,
        groupClient,
        '+refs/heads/merge-group-head:refs/remotes/origin/merge-group-head',
        'refs/remotes/origin/merge-group-head',
      )
      const group = runActualRange(groupClient, {
        EVENT_NAME: 'merge_group',
        PR_BASE_SHA: '',
        PR_HEAD_SHA: '',
        MERGE_GROUP_BASE_SHA: fixture.advancedBaseSha,
        MERGE_GROUP_HEAD_SHA: fixture.mergeGroupHeadSha,
      })
      expect(group.status, group.stderr).toBe(0)
      const groupRange = `${fixture.advancedBaseSha}..${fixture.mergeGroupHeadSha}`
      expect(group.written).toBe(`log-opts=${groupRange}\n`)
      expect(git(groupClient, 'rev-list', groupRange)).toBe(
        git(fixture.sourceRepo, 'rev-list', groupRange),
      )
      expect(git(groupClient, 'rev-list', '--objects', groupRange).split('\n').sort()).toEqual(
        git(fixture.sourceRepo, 'rev-list', '--objects', groupRange).split('\n').sort(),
      )
      expect(
        spawnSync(
          'git',
          ['-C', groupClient, 'cat-file', '-e', `${fixture.distractorSha}^{commit}`],
          {
            timeout: 10_000,
          },
        ).status,
      ).not.toBe(0)
      expect(
        spawnSync('git', ['-C', groupClient, 'cat-file', '-e', `${fixture.tagOnlySha}^{commit}`], {
          timeout: 10_000,
        }).status,
      ).not.toBe(0)
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it.each(['PR_BASE_SHA', 'PR_HEAD_SHA'] as const)(
    'rejects malformed %s before fetching',
    (name) => {
      const env = {
        EVENT_NAME: 'pull_request',
        PR_BASE_SHA: 'a'.repeat(40),
        PR_HEAD_SHA: 'b'.repeat(40),
        MERGE_GROUP_BASE_SHA: '',
        MERGE_GROUP_HEAD_SHA: '',
        [name]: 'not-a-full-oid',
      }
      const result = runRange(env)
      expect(result.status).toBe(2)
      expect(result.stdout).toContain('Event base/head must be full commit OIDs')
      expect(result.fetchCalls).toBe('')
    },
  )
})
