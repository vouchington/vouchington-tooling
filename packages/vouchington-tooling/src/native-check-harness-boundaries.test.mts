import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const harness = join(process.cwd(), 'packages/vouchington-tooling/scripts/native-check-harness.sh')
const capture = join(process.cwd(), 'packages/vouchington-tooling/scripts/native-check-capture.mjs')

describe('native-check-harness boundaries', () => {
  it('detects case-only aliases below a numeric parent directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-check-harness-'))
    try {
      const numericParent = join(directory, '123456')
      mkdirSync(numericParent)
      const probe = join(numericParent, 'case-probe')
      writeFileSync(probe, 'probe')
      const caseInsensitive = existsSync(join(numericParent, 'CASE-PROBE'))
      rmSync(probe)
      const summary = join(numericParent, 'summary')
      const jsonl = join(numericParent, 'SUMMARY')
      const result = spawnSync('bash', [
        '-c',
        `source ${JSON.stringify(harness)}; native_check_init ${JSON.stringify(summary)} ${JSON.stringify(jsonl)}`,
      ])
      expect(result.status).toBe(caseInsensitive ? 2 : 0)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('accounts for every byte when smaller chunks wrap the capture ring', () => {
    const result = spawnSync(
      'bash',
      [
        '-c',
        `{ printf 012; sleep 0.05; printf 345; sleep 0.05; printf 678; } | node ${JSON.stringify(capture)} 8`,
      ],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('12345678')
  })
})
