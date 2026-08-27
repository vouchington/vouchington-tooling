import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const harness = join(process.cwd(), 'packages/vouchington-tooling/scripts/native-check-harness.sh')

describe('native-check-harness', () => {
  it('records classifications, durations, and bounded failure output', () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-check-harness-'))
    try {
      const summary = join(directory, 'summary.md')
      const jsonl = join(directory, 'summary.jsonl')
      const script = join(directory, 'run.sh')
      const failure = join(directory, 'failure.sh')
      writeFileSync(failure, 'printf first\nprintf "\\nlast\\n"\nexit 9\n')
      writeFileSync(
        script,
        `source ${JSON.stringify(harness)}\nnative_check_init ${JSON.stringify(summary)} ${JSON.stringify(jsonl)}\nnative_check_run pass -- bash -c 'exit 0'\nnative_check_run fail -- bash ${JSON.stringify(failure)} || true\nnative_check_publish_summary ${JSON.stringify(`${summary}.published`)}\n`,
      )
      execFileSync('bash', [script], { env: { ...process.env, NATIVE_CHECK_TAIL_LINES: '1' } })
      const published = readFileSync(`${summary}.published`, 'utf8')
      expect(published).toContain('| pass | passed | 0 |')
      expect(published).toContain('| fail | failed | 9 |')
      expect(published).toContain('last')
      expect(published).not.toContain('first')
      expect(readFileSync(jsonl, 'utf8')).toContain('"classification":"failed"')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
