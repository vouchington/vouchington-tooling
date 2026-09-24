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
import { delimiter, join, resolve } from 'node:path'

const script = resolve(
  'packages/vouchington-tooling/scripts/gha/download-optional-run-artifacts.sh',
)
const temporaryDirectories: string[] = []

export type RunOptions = {
  readonly args?: readonly string[] | ((temporaryDirectory: string) => readonly string[])
  readonly env?: Readonly<Record<string, string>>
  readonly ghScript?: string
  readonly sleepScript?: string
}

export function runHelper(options: RunOptions = {}) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'download-optional-run-artifacts-'))
  temporaryDirectories.push(temporaryDirectory)
  const binDirectory = join(temporaryDirectory, 'bin')
  const githubOutput = join(temporaryDirectory, 'github-output')
  const ghPath = join(binDirectory, 'gh')
  mkdirSync(binDirectory)
  writeFileSync(
    ghPath,
    options.ghScript ??
      '#!/bin/sh\nif [ "$1" = api ]; then echo transport-download-control; else printf "downloaded %s\\n" "$*"; fi\n',
  )
  chmodSync(ghPath, 0o755)
  if (options.sleepScript !== undefined) {
    const sleepPath = join(binDirectory, 'sleep')
    writeFileSync(sleepPath, options.sleepScript)
    chmodSync(sleepPath, 0o755)
  }
  const args =
    typeof options.args === 'function'
      ? options.args(temporaryDirectory)
      : (options.args ?? [
          '--name',
          'transport-download-control',
          '--dir',
          join(temporaryDirectory, 'coverage-control'),
        ])
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_OUTPUT: githubOutput,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_RUN_ID: '1234',
      PATH: binDirectory + delimiter + process.env.PATH,
      ...options.env,
    },
  })
  return {
    ...result,
    output: existsSync(githubOutput) ? readFileSync(githubOutput, 'utf8') : '',
    temporaryDirectory,
  }
}

export function cleanupTemporaryDirectories() {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true })
}
