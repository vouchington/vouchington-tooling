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
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseGithubOutput } from './github-output.test-helpers.mts'

const temporaryDirectories: string[] = []
const defaultRandomHex = '12345678abcd4def8123123456789abc'

type RunOptions = {
  args?: string[]
  githubOutput?: string
  payload?: string | Buffer
  randomSourceScript?: string
  randomHexValues?: string[]
}

function runHelper(options: RunOptions = {}) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'write-github-multiline-output-'))
  temporaryDirectories.push(temporaryDirectory)
  const fakeBinDirectory = join(temporaryDirectory, 'bin')
  const githubOutput = options.githubOutput ?? join(temporaryDirectory, 'github-output')
  const odPath = join(fakeBinDirectory, 'od')
  const uuidgenPath = join(fakeBinDirectory, 'uuidgen')

  mkdirSync(fakeBinDirectory)

  writeFileSync(
    odPath,
    options.randomSourceScript ??
      `#!/bin/sh
if [ "$*" != "-An -v -N16 -tx1 /dev/urandom" ]; then
  echo "unexpected od arguments: $*" >&2
  exit 64
fi
counter_file="$FAKE_RANDOM_COUNTER"
count=0
if [ -f "$counter_file" ]; then read -r count < "$counter_file"; fi
count=$((count + 1))
printf '%s\n' "$count" > "$counter_file"
printf '%s\n' "$FAKE_RANDOM_VALUES" | sed -n "\${count}p"
`,
  )
  writeFileSync(uuidgenPath, '#!/bin/sh\necho "uuidgen must not be called" >&2\nexit 97\n')
  chmodSync(odPath, 0o755)
  chmodSync(uuidgenPath, 0o755)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FAKE_RANDOM_COUNTER: join(temporaryDirectory, 'random-count'),
    FAKE_RANDOM_VALUES: (options.randomHexValues ?? [defaultRandomHex]).join('\n'),
    GITHUB_OUTPUT: githubOutput,
    PATH: fakeBinDirectory + delimiter + (process.env['PATH'] ?? ''),
    RUNNER_TEMP: temporaryDirectory,
  }
  if (options.githubOutput === '') delete env.GITHUB_OUTPUT

  const result = spawnSync(
    'bash',
    [
      'packages/vouchington-tooling/scripts/gha/write-github-multiline-output.sh',
      ...(options.args ?? ['codex_fix_request']),
    ],
    {
      encoding: 'utf8',
      env,
      input: options.payload ?? '',
    },
  )

  return {
    ...result,
    githubOutput,
    output: result.status === 0 ? readFileSync(githubOutput) : undefined,
    randomSourceCalls: existsSync(env.FAKE_RANDOM_COUNTER!)
      ? readFileSync(env.FAKE_RANDOM_COUNTER!, 'utf8').trim()
      : '0',
  }
}

describe('write-github-multiline-output', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('writes malicious output-looking payloads as one multiline output', () => {
    const payload = [
      'preserve this request',
      'CODEX_FIX_REQUEST',
      'codex_fix_request=forged',
      'sibling<<FORGED',
      'attacker-controlled',
      'FORGED',
    ].join('\n')

    const result = runHelper({ payload })

    expect(result.status).toBe(0)
    expect(parseGithubOutput(result.output!.toString())).toEqual({ codex_fix_request: payload })
  })

  it('retries when a generated delimiter occurs in the payload', () => {
    const firstRandomHex = '11111111aaaa4bbb8ccc111111111111'
    const secondRandomHex = '22222222dddd4eee8fff222222222222'
    const payload = `prefixCODEX_FIX_REQUEST_${firstRandomHex.toUpperCase()}suffix`

    const result = runHelper({
      payload,
      randomHexValues: [firstRandomHex, secondRandomHex],
    })

    expect(result.status).toBe(0)
    expect(result.randomSourceCalls).toBe('2')
    expect(result.output!.toString()).toContain(
      `codex_fix_request<<CODEX_FIX_REQUEST_${secondRandomHex.toUpperCase()}\n`,
    )
    expect(parseGithubOutput(result.output!.toString())).toEqual({ codex_fix_request: payload })
  })

  it('preserves empty and line-oriented payload variants', () => {
    const marker = `CODEX_FIX_REQUEST_${defaultRandomHex.toUpperCase()}`

    expect(runHelper().output!.toString()).toBe(`codex_fix_request<<${marker}\n${marker}\n`)
    expect(runHelper({ payload: 'one line' }).output!.toString()).toBe(
      `codex_fix_request<<${marker}\none line\n${marker}\n`,
    )
    expect(runHelper({ payload: 'one line\n' }).output!.toString()).toBe(
      `codex_fix_request<<${marker}\none line\n${marker}\n`,
    )
  })

  it('preserves percent signs, CRLF bytes, and leading -n text', () => {
    const payload = Buffer.from('-n literal\r\n100% complete\r\n')
    const result = runHelper({ args: ['mixed-name'], payload })
    const marker = `MIXED_NAME_${defaultRandomHex.toUpperCase()}`

    expect(result.status).toBe(0)
    expect(result.output).toEqual(
      Buffer.concat([Buffer.from(`mixed-name<<${marker}\n`), payload, Buffer.from(`${marker}\n`)]),
    )
  })

  it('rejects invalid arguments, names, and missing output paths', () => {
    const noArguments = runHelper({ args: [] })
    const extraArgument = runHelper({ args: ['valid', 'extra'] })
    const invalidNames = ['-leading-hyphen', 'has space', 'has.dot', '']
    const invalidNameResults = invalidNames.map((name) => runHelper({ args: [name] }))
    const missingOutput = runHelper({ githubOutput: '' })

    expect(noArguments.status).toBe(2)
    expect(noArguments.stderr).toContain('usage:')
    expect(extraArgument.status).toBe(2)
    expect(extraArgument.stderr).toContain('usage:')
    for (const result of invalidNameResults) {
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('invalid GitHub output name')
    }
    expect(missingOutput.status).toBe(2)
    expect(missingOutput.stderr).toContain('GITHUB_OUTPUT must be set')
  })

  it('fails clearly when random suffix generation fails', () => {
    const commandFailure = runHelper({ randomSourceScript: '#!/bin/sh\nexit 42\n' })
    const invalidValues = ['', 'not-hex', 'abcd'].map((value) =>
      runHelper({ randomHexValues: [value] }),
    )

    expect(commandFailure.status).toBe(1)
    expect(commandFailure.stderr).toContain('random suffix generation failed')
    for (const result of invalidValues) {
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'random suffix generator returned an invalid GitHub output delimiter suffix',
      )
    }
  })

  it('fails after ten delimiter collisions', () => {
    const normalizedRandomHex = defaultRandomHex.toUpperCase()
    const result = runHelper({
      payload: `CODEX_FIX_REQUEST_${normalizedRandomHex}`,
      randomHexValues: Array.from({ length: 10 }, () => defaultRandomHex),
    })

    expect(result.status).toBe(1)
    expect(result.randomSourceCalls).toBe('10')
    expect(result.stderr).toContain('after 10 attempts')
  })
})
