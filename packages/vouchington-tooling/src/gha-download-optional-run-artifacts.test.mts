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

import { afterEach, describe, expect, it } from 'vitest'

const script = resolve(
  'packages/vouchington-tooling/scripts/gha/download-optional-run-artifacts.sh',
)
const temporaryDirectories: string[] = []

type RunOptions = {
  readonly args?: readonly string[] | ((temporaryDirectory: string) => readonly string[])
  readonly env?: Readonly<Record<string, string>>
  readonly ghScript?: string
}

function runHelper(options: RunOptions = {}) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'download-optional-run-artifacts-'))
  temporaryDirectories.push(temporaryDirectory)
  const binDirectory = join(temporaryDirectory, 'bin')
  const githubOutput = join(temporaryDirectory, 'github-output')
  const ghPath = join(binDirectory, 'gh')
  mkdirSync(binDirectory)
  writeFileSync(ghPath, options.ghScript ?? '#!/bin/sh\nprintf "downloaded %s\\n" "$*"\n')
  chmodSync(ghPath, 0o755)
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

describe('download-optional-run-artifacts', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0))
      rmSync(directory, { force: true, recursive: true })
  })

  it('reports an available exact same-run artifact without a warning', () => {
    const result = runHelper()

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('--name transport-download-control')
    expect(result.stderr).toContain('[optional-run-artifacts] result=available selector=name')
    expect(result.output).toBe('availability=available\n')
  })

  it('reports an unavailable patterned same-run artifact when nothing matches', () => {
    const result = runHelper({
      args: (temporaryDirectory) => [
        '--pattern',
        '*',
        '--dir',
        join(temporaryDirectory, 'coverage-fallback'),
      ],
      ghScript: '#!/bin/sh\n[ "$1" = api ] && exit 0\nexit 99\n',
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('[optional-run-artifacts] selection selector=pattern count=0')
    expect(result.stderr).toContain(
      '[optional-run-artifacts] result=unavailable selector=pattern exit=1',
    )
    expect(result.output).toBe('availability=unavailable\n')
  })

  it.each(['.', '..'])('rejects unsafe patterned artifact directory %s', (artifact) => {
    const result = runHelper({
      args: (temporaryDirectory) => [
        '--pattern',
        '*',
        '--dir',
        join(temporaryDirectory, 'coverage-fallback'),
      ],
      ghScript: `#!/bin/sh
if [ "$1" = api ]; then printf '%s\\n' '${artifact}'; exit 0; fi
exit 99
`,
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('[optional-run-artifacts] result=error selector=pattern exit=2')
    expect(result.output).toBe('')
  })

  it.each(['.', '..', 'nested/name'])('rejects unsafe exact artifact name %s', (artifact) => {
    const result = runHelper({
      args: (temporaryDirectory) => [
        '--name',
        artifact,
        '--dir',
        join(temporaryDirectory, 'coverage-control'),
      ],
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('[optional-run-artifacts] result=error selector=name exit=2')
    expect(result.stdout).toBe('')
    expect(result.output).toBe('')
  })

  it('accepts valid names with spaces and Unicode characters', () => {
    const result = runHelper({
      args: (temporaryDirectory) => [
        '--pattern',
        'coverage *',
        '--dir',
        join(temporaryDirectory, 'coverage-fallback'),
      ],
      ghScript: `#!/bin/sh
if [ "$1" = api ]; then printf '%s\\n' 'coverage λinux'; exit 0; fi
name=''; dir=''
while [ "$#" -gt 0 ]; do
  case "$1" in --name) name="$2"; shift 2;; --dir) dir="$2"; shift 2;; *) shift;; esac
done
mkdir -p "$dir"
printf '%s\\n' "$name" > "$dir/artifact-name"
`,
    })

    expect(result.status).toBe(0)
    expect(
      readFileSync(
        join(result.temporaryDirectory, 'coverage-fallback/coverage λinux/artifact-name'),
        'utf8',
      ),
    ).toBe('coverage λinux\n')
  })

  it('targets the Actions server host', () => {
    const result = runHelper({ env: { GH_HOST: '', GITHUB_SERVER_URL: 'https://ghe.example' } })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('--repo ghe.example/owner/repo')
  })

  it('preserves each patterned artifact under its artifact-name directory', () => {
    const result = runHelper({
      args: (temporaryDirectory) => [
        '--pattern',
        'coverage-*',
        '--dir',
        join(temporaryDirectory, 'coverage-fallback'),
      ],
      ghScript: `#!/bin/sh
if [ "$1" = api ]; then printf '%s\\n' coverage-tooling coverage-tooling coverage-web; exit 0; fi
name=''; dir=''
while [ "$#" -gt 0 ]; do
  case "$1" in --name) name="$2"; shift 2;; --dir) dir="$2"; shift 2;; *) shift;; esac
done
mkdir -p "$dir"
printf '%s\\n' "$name" > "$dir/artifact-name"
`,
    })

    expect(result.status).toBe(0)
    expect(
      readFileSync(
        join(result.temporaryDirectory, 'coverage-fallback/coverage-tooling/artifact-name'),
        'utf8',
      ),
    ).toBe('coverage-tooling\n')
    expect(
      readFileSync(
        join(result.temporaryDirectory, 'coverage-fallback/coverage-web/artifact-name'),
        'utf8',
      ),
    ).toBe('coverage-web\n')
    expect(result.stderr).toContain('[optional-run-artifacts] selection selector=pattern count=2')
    expect(result.stderr.match(/attempt artifact=coverage-tooling/g)).toHaveLength(1)
  })

  it('announces every selected artifact before the first sequential download failure', () => {
    const result = runHelper({
      args: (temporaryDirectory) => [
        '--pattern',
        'coverage-*',
        '--dir',
        join(temporaryDirectory, 'coverage-fallback'),
      ],
      ghScript: `#!/bin/sh
if [ "$1" = api ]; then printf '%s\\n' coverage-tooling coverage-web; exit 0; fi
exit 1
`,
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('[optional-run-artifacts] selected artifact=coverage-tooling')
    expect(result.stderr).toContain('[optional-run-artifacts] selected artifact=coverage-web')
    expect(result.stderr).toContain('[optional-run-artifacts] selection selector=pattern count=2')
    expect(result.stderr).toContain('[optional-run-artifacts] attempt artifact=coverage-tooling')
    expect(result.stderr).not.toContain('[optional-run-artifacts] attempt artifact=coverage-web')
    expect(result.output).toBe('availability=unavailable\n')
  })

  it('preserves the downloader diagnostic and normalizes expected unavailability', () => {
    const result = runHelper({
      ghScript: '#!/bin/sh\necho "Artifact not found" >&2\nexit 1\n',
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('Artifact not found')
    expect(result.stderr).toContain(
      '::warning::Optional same-run artifact unavailable; continuing with validated fallback (selector=name exit=1)',
    )
    expect(result.stderr).not.toContain('::error::')
    expect(result.output).toBe('availability=unavailable\n')
  })

  it.each([130, 143])('preserves cancellation exit code %i', (status) => {
    const result = runHelper({ ghScript: `#!/bin/sh\nexit ${status}\n` })

    expect(result.status).toBe(status)
    expect(result.stderr).toContain('[optional-run-artifacts] attempt selector=name')
    expect(result.output).toBe('')
  })

  it.each([
    { args: [] },
    { args: ['--name', 'control', '--pattern', 'coverage-*', '--dir', './out'] },
    { args: ['--name', 'control'] },
    { args: ['--name', 'control', '--dir', './out', '--unexpected'] },
  ])('rejects invalid arguments: $args', ({ args }) => {
    const result = runHelper({ args })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage:')
  })
})
