import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('download-with-diagnostics', () => {
  const testDirs: string[] = []

  afterEach(async () => {
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  async function makeFakeCurl(script: string) {
    const dir = await mkdtemp(join(tmpdir(), 'download-curl-'))
    testDirs.push(dir)
    const curlPath = join(dir, 'curl')
    await writeFile(curlPath, script)
    await chmod(curlPath, 0o755)
    return dir
  }

  async function runDownload(options: {
    curlScript: string
    scriptPrefix?: string
    scriptSuffix?: string
    summary?: string
  }) {
    const dir = await mkdtemp(join(tmpdir(), 'download-test-'))
    testDirs.push(dir)
    const binDir = await makeFakeCurl(options.curlScript)
    const destination = join(dir, 'download.bin')
    const summary = options.summary ?? join(dir, 'summary.md')
    const script = [
      options.scriptPrefix ?? 'set -euo pipefail',
      'source ./packages/vouchington-tooling/scripts/gha/download-with-diagnostics.sh',
      options.scriptSuffix ??
        `ci_download_to "https://example.test/tool.tar.gz" "${destination}" --retry 3`,
    ].join('\n')

    const result = await execFileAsync('/bin/bash', ['-c', script], {
      env: {
        ...process.env,
        DOWNLOAD_DESTINATION: destination,
        GITHUB_STEP_SUMMARY: summary,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
      },
    }).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ error, ok: false as const }),
    )

    return { destination, result, summary }
  }

  it('downloads when invoked as an executable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'download-exec-'))
    testDirs.push(dir)
    const binDir = await makeFakeCurl(`#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    shift
    printf 'artifact' > "$1"
  fi
  shift
done
printf '200'
`)
    const destination = join(dir, 'download.bin')
    await execFileAsync(
      'bash',
      [
        './packages/vouchington-tooling/scripts/gha/download-with-diagnostics.sh',
        'https://example.test/tool.tar.gz',
        destination,
      ],
      { env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` } },
    )
    await expect(readFile(destination, 'utf8')).resolves.toBe('artifact')
  })

  it('keeps the destination on successful 2xx responses', async () => {
    const { destination, result, summary } = await runDownload({
      curlScript: `#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    shift
    printf 'artifact' > "$1"
  fi
  shift
done
printf '200'
`,
    })

    expect(result.ok).toBe(true)
    await expect(readFile(destination, 'utf8')).resolves.toBe('artifact')
    await expect(stat(summary)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('prints and summarizes non-2xx HTTP responses', async () => {
    const { destination, result, summary } = await runDownload({
      curlScript: `#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    shift
    printf 'partial' > "$1"
  fi
  shift
done
printf '504'
`,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error).toMatchObject({ code: 1 })
    expect(result.error.stdout).toContain(
      'DOWNLOAD FAILED: https://example.test/tool.tar.gz → HTTP 504',
    )
    await expect(readFile(summary, 'utf8')).resolves.toContain(
      'DOWNLOAD FAILED: https://example.test/tool.tar.gz → HTTP 504',
    )
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports HTTP 000 for transport failures and removes any partial destination', async () => {
    const { destination, result, summary } = await runDownload({
      curlScript: `#!/usr/bin/env bash
# Write a partial file to --output to prove cleanup runs on transport failure too
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    shift
    printf 'partial' > "$1"
  fi
  shift
done
printf '000'
exit 7
`,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.stdout).toContain(
      'DOWNLOAD FAILED: https://example.test/tool.tar.gz → HTTP 000',
    )
    await expect(readFile(summary, 'utf8')).resolves.toContain(
      'DOWNLOAD FAILED: https://example.test/tool.tar.gz → HTTP 000',
    )
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves a caller with errexit disabled', async () => {
    const { result } = await runDownload({
      curlScript: `#!/usr/bin/env bash
printf '000'
exit 7
`,
      scriptPrefix: 'set +e',
      scriptSuffix: [
        'ci_download_to "https://example.test/tool.tar.gz" "$DOWNLOAD_DESTINATION" --retry 3',
        'download_status=$?',
        'false',
        'false_status=$?',
        String.raw`printf "download=%s false=%s\n" "$download_status" "$false_status"`,
        'exit 0',
      ].join('\n'),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.value.stdout).toContain('download=1 false=1')
  })

  it('rejects missing arguments before invoking curl', async () => {
    const { result } = await runDownload({
      curlScript: `#!/usr/bin/env bash
echo 'curl should not run' >&2
exit 9
`,
      scriptSuffix: 'ci_download_to "https://example.test/tool.tar.gz"',
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error).toMatchObject({ code: 1 })
    expect(result.error.stderr).toContain(
      'Error: ci_download_to requires both url and destination arguments',
    )
    expect(result.error.stderr).not.toContain('curl should not run')
  })

  // Shared fake-curl stub: dumps all positional args to stderr (one per line) so tests can
  // inspect the flags ci_download_to passes, then writes a dummy artifact and returns HTTP 200.
  const FAKE_CURL_DUMP_ARGS = `#!/usr/bin/env bash
printf '%s\\n' "$@" >&2
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    shift
    printf 'artifact' > "$1"
  fi
  shift
done
printf '200'
`

  it('passes default --connect-timeout and --max-time to curl when caller omits them', async () => {
    const { result } = await runDownload({
      curlScript: FAKE_CURL_DUMP_ARGS,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    const args = result.value.stderr.split('\n').filter(Boolean)
    const ctIdx = args.indexOf('--connect-timeout')
    const mtIdx = args.indexOf('--max-time')
    expect(ctIdx).toBeGreaterThanOrEqual(0)
    expect(args[ctIdx + 1]).toBe('30')
    expect(mtIdx).toBeGreaterThanOrEqual(0)
    expect(args[mtIdx + 1]).toBe('120')
  })

  it('lets callers override the default --max-time via a trailing flag', async () => {
    const { result } = await runDownload({
      curlScript: FAKE_CURL_DUMP_ARGS,
      scriptSuffix: `ci_download_to "https://example.test/tool.tar.gz" "$DOWNLOAD_DESTINATION" --max-time 5`,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    const args = result.value.stderr.split('\n').filter(Boolean)
    // Default appears first, then caller override after "$@" expansion
    const firstMaxTimeIdx = args.indexOf('--max-time')
    const secondMaxTimeIdx = args.indexOf('--max-time', firstMaxTimeIdx + 1)
    expect(firstMaxTimeIdx).toBeGreaterThanOrEqual(0)
    expect(args[firstMaxTimeIdx + 1]).toBe('120')
    expect(secondMaxTimeIdx).toBeGreaterThan(firstMaxTimeIdx)
    expect(args[secondMaxTimeIdx + 1]).toBe('5')
  })

  it('tolerates a summary-write failure without masking the download error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'download-summary-'))
    testDirs.push(dir)
    // Use a directory path as the summary so the append write fails
    const summaryDir = join(dir, 'summary-is-a-dir')
    await mkdir(summaryDir)

    const { result } = await runDownload({
      curlScript: `#!/usr/bin/env bash
printf '000'
exit 7
`,
      summary: summaryDir,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error).toMatchObject({ code: 1 })
    expect(result.error.stdout).toContain(
      'DOWNLOAD FAILED: https://example.test/tool.tar.gz → HTTP 000',
    )
  })
})
