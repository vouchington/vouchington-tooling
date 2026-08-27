import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const harness = join(process.cwd(), 'packages/vouchington-tooling/scripts/native-check-harness.sh')
const capture = join(process.cwd(), 'packages/vouchington-tooling/scripts/native-check-capture.mjs')

describe('native-check-harness', () => {
  it('retains the exact byte tail with bounded storage', () => {
    const result = spawnSync('node', [capture, '4'], { encoding: 'utf8', input: '0123456789' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('6789')
  })

  it('rejects capture allocations above the hard limit', () => {
    const result = spawnSync('node', [capture, String(10 * 1024 * 1024 + 1)], { input: 'value' })
    expect(result.status).toBe(2)
  })

  it('retains the exact byte tail when separate chunks wrap the buffer', () => {
    const result = spawnSync(
      'bash',
      ['-c', `{ printf abc; sleep 0.05; printf de; } | node ${JSON.stringify(capture)} 4`],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('bcde')
  })

  it('records classifications, durations, and bounded failure output', () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-check-harness-'))
    try {
      const summary = join(directory, 'summary.md')
      const jsonl = join(directory, 'summary.jsonl')
      const script = join(directory, 'run.sh')
      const failure = join(directory, 'failure.sh')
      writeFileSync(failure, "printf first\nprintf '\\n%s\\nlast' '```'\nexit 9\n")
      writeFileSync(
        script,
        `source ${JSON.stringify(harness)}\nnative_check_init ${JSON.stringify(summary)} ${JSON.stringify(jsonl)}\nnative_check_run fail -- bash ${JSON.stringify(failure)} || true\nnative_check_run pass -- bash -c 'exit 0'\nnative_check_publish_summary ${JSON.stringify(`${summary}.published`)}\n`,
      )
      execFileSync('bash', [script], { env: { ...process.env, NATIVE_CHECK_TAIL_LINES: '2' } })
      const published = readFileSync(`${summary}.published`, 'utf8')
      expect(published).toContain('| pass | passed | 0 |')
      expect(published).toContain('| fail | failed | 9 |')
      expect(published).toContain('last')
      expect(published).not.toContain('first')
      expect(published).toContain('    ```')
      expect(published).not.toContain('```text')
      expect(published.indexOf('| fail |')).toBeLessThan(published.indexOf('| pass |'))
      expect(published.indexOf('| pass |')).toBeLessThan(published.indexOf('### fail'))
      expect(published).toContain('    last\n')
      expect(readFileSync(jsonl, 'utf8')).toContain('"classification":"failed"')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('rejects unsafe names and bounds output while the command runs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-check-harness-'))
    try {
      const summary = join(directory, 'summary.md')
      const jsonl = join(directory, 'summary.jsonl')
      const script = join(directory, 'run.sh')
      const artifact = join(directory, 'artifact.bin')
      writeFileSync(
        script,
        `source ${JSON.stringify(harness)}\nnative_check_init ${JSON.stringify(summary)} ${JSON.stringify(jsonl)}\nnative_check_run 'unsafe|name' -- bash -c 'exit 0' && exit 1\nnative_check_run bounded -- bash -c 'head -c 8192 /dev/zero > "$1"; yes x | head -c 8192; exit 9' _ ${JSON.stringify(artifact)} || true\n`,
      )
      execFileSync('bash', [script], {
        env: { ...process.env, NATIVE_CHECK_MAX_OUTPUT_KIB: '1', NATIVE_CHECK_TAIL_LINES: '1' },
        stdio: 'pipe',
      })
      expect(readFileSync(summary, 'utf8')).toContain('| bounded |')
      expect(readFileSync(`${summary}.diagnostics`, 'utf8')).toContain('exit 9')
      expect(readFileSync(summary, 'utf8').length).toBeLessThan(2048)
      expect(readFileSync(jsonl, 'utf8')).not.toContain('unsafe|name')
      expect(statSync(artifact).size).toBe(8192)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('clamps configured capture and summary limits', () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-check-harness-'))
    try {
      const summary = join(directory, 'summary.md')
      const jsonl = join(directory, 'summary.jsonl')
      const script = join(directory, 'run.sh')
      writeFileSync(
        script,
        `source ${JSON.stringify(harness)}\nnative_check_init ${JSON.stringify(summary)} ${JSON.stringify(jsonl)}\nnative_check_run bounded -- bash -c 'for value in {1..1001}; do printf "line-%s\\n" "$value"; done; exit 9' || true\n`,
      )
      execFileSync('bash', [script], {
        env: {
          ...process.env,
          NATIVE_CHECK_MAX_OUTPUT_KIB: '10241',
          NATIVE_CHECK_TAIL_LINES: '1001',
        },
      })
      const rendered = readFileSync(`${summary}.diagnostics`, 'utf8')
      expect(rendered).not.toContain('line-1\n')
      expect(rendered).toContain('line-2\n')
      expect(rendered).toContain('line-1001\n')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('interprets zero-padded capture limits as decimal', () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-check-harness-'))
    try {
      const summary = join(directory, 'summary.md')
      const jsonl = join(directory, 'summary.jsonl')
      const script = join(directory, 'run.sh')
      writeFileSync(
        script,
        `source ${JSON.stringify(harness)}\nnative_check_init ${JSON.stringify(summary)} ${JSON.stringify(jsonl)}\nnative_check_run padded -- node -e 'process.stdout.write("prefix" + "x".repeat(9000)); process.exitCode = 9' || true\n`,
      )
      execFileSync('bash', [script], {
        env: {
          ...process.env,
          NATIVE_CHECK_MAX_OUTPUT_KIB: '010',
          NATIVE_CHECK_TAIL_LINES: '01',
        },
      })
      expect(readFileSync(`${summary}.diagnostics`, 'utf8')).toContain('prefix')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('publishes safely when the summary source is also the destination', () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-check-harness-'))
    try {
      const summary = join(directory, 'summary.md')
      const jsonl = join(directory, 'summary.jsonl')
      const script = join(directory, 'run.sh')
      writeFileSync(
        script,
        `source ${JSON.stringify(harness)}\nnative_check_init ${JSON.stringify(summary)} ${JSON.stringify(jsonl)}\nnative_check_run fail -- bash -c 'printf diagnostic; exit 9' || true\nGITHUB_STEP_SUMMARY=${JSON.stringify(summary)} native_check_publish_summary\n`,
      )
      execFileSync('bash', [script])
      const published = readFileSync(summary, 'utf8')
      expect(published).toContain('## Check summary')
      expect(published).toContain('| fail | failed | 9 |')
      expect(published).toContain('    diagnostic\n')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
