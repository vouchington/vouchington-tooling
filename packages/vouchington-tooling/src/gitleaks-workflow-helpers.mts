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

export interface Step {
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
export const source = readFileSync(join(root, '.github/workflows/gitleaks.yml'), 'utf8')
export const workflow = load(source) as {
  on: { workflow_call: { inputs: Record<string, { default?: string }> } }
  jobs: { gitleaks: { 'timeout-minutes': number; steps: Step[] } }
}
export const steps = workflow.jobs.gitleaks.steps

export function step(name: string) {
  const found = steps.find((candidate) => candidate.name === name)
  if (!found?.run) throw new Error(`missing step ${name}`)
  return found
}

export const FAKE_TIP = 'f'.repeat(40)
export const FAKE_TOP = '1'.repeat(40)
export const FAKE_BOUNDARY = 'e'.repeat(40)

export function runRange(env: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'gitleaks-range-'))
  const bin = join(directory, 'bin')
  const output = join(directory, 'output')
  const fetchLog = join(directory, 'fetch-log')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'git'),
    `#!/bin/bash
if [ "$1" = fetch ]; then printf '%s\\n' "$*" >> "$GIT_FETCH_LOG"; exit 0; fi
if [ "$1" = rev-list ] && [ "$2" = --no-walk ]; then [ -z "$GIT_PARENTS" ] || printf '%b\n' "$GIT_PARENTS"; exit 0; fi
if [ "$1" = rev-list ]; then [ -z "$GIT_RANGE" ] || printf '%b\n' "$GIT_RANGE"; exit 0; fi
echo "unexpected git $*" >&2
exit 1
`,
  )
  chmodSync(join(bin, 'git'), 0o755)
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/bash
printf 'api %s\n' "$2" >> "$GIT_FETCH_LOG"
case "$2" in *'&page='*) printf '%b\n' "$GH_COMMITS" ;; *) printf '%s\n' "$GH_AHEAD" ;; esac
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
          GH_AHEAD: '2',
          GH_COMMITS: `${FAKE_TIP}\n${FAKE_TOP}`,
          GIT_PARENTS: `${FAKE_TIP} ${FAKE_BOUNDARY}\n${FAKE_TOP} ${FAKE_TIP}`,
          GIT_RANGE: `${FAKE_TIP}\n${FAKE_TOP}`,
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

export function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 10_000 })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

export function shallowClient(remote: string, directory: string, refspec: string, ref: string) {
  mkdirSync(directory)
  git(directory, 'init', '--quiet')
  git(directory, 'remote', 'add', 'origin', remote)
  git(directory, 'fetch', '--quiet', '--depth=1', 'origin', refspec)
  git(directory, 'checkout', '--quiet', '--detach', ref)
}

let ghStubDir = ''

export function writeGhStub(directory: string, sourceRepo: string) {
  ghStubDir = join(directory, 'gh-bin')
  mkdirSync(ghStubDir)
  writeFileSync(
    join(ghStubDir, 'gh'),
    `#!/bin/bash
url="$2"
range="\${url##*/compare/}"
range="\${range%%[?]*}"
base="\${range%%...*}"
head="\${range##*...}"
mb=$(git -C '${sourceRepo}' merge-base "$base" "$head")
case "$url" in
  *'&page='*)
    size="\${url##*per_page=}"
    size="\${size%%&*}"
    page="\${url##*&page=}"
    git -C '${sourceRepo}' rev-list "$mb..$head" | sed -n "$(( (page - 1) * size + 1 )),$(( page * size ))p"
    ;;
  *) git -C '${sourceRepo}' rev-list --count "$mb..$head" ;;
esac
`,
  )
  chmodSync(join(ghStubDir, 'gh'), 0o755)
}

export function runActualRange(directory: string, env: Record<string, string>) {
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
