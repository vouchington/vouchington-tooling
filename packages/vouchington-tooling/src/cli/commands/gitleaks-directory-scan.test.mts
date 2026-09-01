import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gitleaks-directory-scan.sh',
)

describe('gitleaks-directory-scan', () => {
  it('scans cleaned staged and nonignored working-tree mirrors', () => {
    const root = mkdtempSync(join(tmpdir(), 'gitleaks-directory-'))
    try {
      mkdirSync(join(root, 'bin'))
      copyFileSync(source, join(root, 'scan.sh'))
      writeFileSync(join(root, '.gitleaks.toml'), 'title = "staged"\n')
      writeFileSync(join(root, '.gitignore'), 'ignored.txt\n')
      writeFileSync(join(root, 'tracked.txt'), 'staged\n')
      writeFileSync(join(root, 'ignored.txt'), 'ignore\n')
      expect(spawnSync('git', ['init', '--quiet'], { cwd: root }).status).toBe(0)
      expect(spawnSync('git', ['add', '.'], { cwd: root }).status).toBe(0)
      writeFileSync(join(root, '.gitleaks.toml'), 'title = "working"\n')
      writeFileSync(join(root, 'tracked.txt'), 'working\n')
      writeFileSync(join(root, 'untracked.txt'), 'candidate\n')
      const log = join(root, 'log')
      const stub = join(root, 'bin/gitleaks')
      writeFileSync(stub, '#!/bin/sh\nprintf "%s:%s\\n" "$PWD" "$(cat "$3")" >> "$LOG"\n')
      chmodSync(stub, 0o755)
      const scratch = join(root, 'scratch')
      mkdirSync(scratch)
      const result = spawnSync('bash', ['scan.sh', '--config', '.gitleaks.toml'], {
        cwd: root,
        env: {
          ...process.env,
          LOG: log,
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          TMPDIR: scratch,
        },
      })
      expect(result.status).toBe(0)
      const scans = readFileSync(log, 'utf8').trim().split('\n')
      expect(scans).toHaveLength(2)
      expect(scans[0]).toContain('title = "staged"')
      expect(scans[1]).toContain('title = "working"')
      for (const scan of scans) expect(existsSync(scan.split(':')[0] ?? '')).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
