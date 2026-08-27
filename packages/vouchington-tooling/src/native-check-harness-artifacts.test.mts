import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'

const harness = join(process.cwd(), 'packages/vouchington-tooling/scripts/native-check-harness.sh')

describe('native-check-harness artifact failures', () => {
  it('records a failing check under caller errexit and pipefail', () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-check-harness-'))
    try {
      const summary = join(directory, 'summary.md')
      const jsonl = join(directory, 'summary.jsonl')
      const script = `set -e -o pipefail\nsource ${JSON.stringify(harness)}\nnative_check_init ${JSON.stringify(summary)} ${JSON.stringify(jsonl)}\nnative_check_run fail -- bash -c 'exit 9'\n`
      expect(spawnSync('bash', ['-c', script]).status).toBe(9)
      expect(readFileSync(summary, 'utf8')).toContain('| fail | failed | 9 |')
      expect(readFileSync(jsonl, 'utf8')).toContain('"exitCode":9')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('restores caller pipefail after recording a failed check', () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-check-harness-'))
    try {
      const summary = join(directory, 'summary.md')
      const jsonl = join(directory, 'summary.jsonl')
      const script = `set -e -o pipefail\nsource ${JSON.stringify(harness)}\nnative_check_init ${JSON.stringify(summary)} ${JSON.stringify(jsonl)}\nnative_check_run fail -- bash -c 'exit 9' || status=$?\n[ "$status" -eq 9 ]\nfalse | true\n`
      expect(spawnSync('bash', ['-c', script]).status).toBe(1)
      expect(readFileSync(summary, 'utf8')).toContain('| fail | failed | 9 |')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('propagates diagnostics append failures under an || list', () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-check-harness-'))
    try {
      const summary = join(directory, 'summary.md')
      const jsonl = join(directory, 'summary.jsonl')
      const diagnostics = `${summary}.diagnostics`
      const script = `source ${JSON.stringify(harness)}\nnative_check_init ${JSON.stringify(summary)} ${JSON.stringify(jsonl)}\nrm -f ${JSON.stringify(diagnostics)}; mkdir ${JSON.stringify(diagnostics)}\nresult=0; native_check_run fail -- bash -c 'exit 9' || result=$?\n[ "$result" -eq 1 ]\n`
      expect(spawnSync('bash', ['-c', script]).status).toBe(0)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
