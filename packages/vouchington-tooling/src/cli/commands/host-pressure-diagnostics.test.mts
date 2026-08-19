import { chmod, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanupTestHomes,
  execFileAsync,
  makeHome,
} from '../../host-lock/with-host-lock.test-helpers.mts'

const diagnosticsScript = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gha/host-pressure-diagnostics.sh',
)

describe('ci/host-pressure-diagnostics.sh', () => {
  afterEach(cleanupTestHomes)

  it('emits bounded cross-platform host and runner evidence without failing', async () => {
    const { stdout } = await execFileAsync('bash', [diagnosticsScript], {
      env: { ...process.env, LC_ALL: 'C' },
      maxBuffer: 1024 * 1024,
    })

    expect(stdout).toContain('== host pressure diagnostics ==')
    expect(stdout).toContain('platform:')
    expect(stdout).toContain('== top rss processes ==')
    expect(stdout).toContain('== runner worker/listener counts ==')
    expect(stdout.length).toBeLessThan(1024 * 1024)
  })

  it('caps kernel OOM evidence before retaining it in memory', async () => {
    const fakeBin = await makeHome()
    const executable = async (name: string, source: string) => {
      const path = join(fakeBin, name)
      await writeFile(path, source)
      await chmod(path, 0o755)
    }
    await executable('uname', '#!/usr/bin/env bash\nprintf "Linux\\n"\n')
    await executable('timeout', '#!/usr/bin/env bash\nshift\nexec "$@"\n')
    await executable(
      'journalctl',
      `#!/usr/bin/env bash
for i in $(seq 1 200); do
  printf 'oom-line-%03d ' "$i"
  printf '%02000d\\n' 0
done
`,
    )

    const { stdout } = await execFileAsync('bash', [diagnosticsScript], {
      env: {
        ...process.env,
        LC_ALL: 'C',
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
      },
      maxBuffer: 1024 * 1024,
    })
    const oomLines = stdout.split('\n').filter((line) => line.startsWith('oom-line-'))

    expect(oomLines).toHaveLength(50)
    expect(oomLines.every((line) => line.length <= 1000)).toBe(true)
    expect(oomLines[0]).toMatch(/^oom-line-151 /)
    expect(oomLines.at(-1)).toMatch(/^oom-line-200 /)
  })

  it('counts only runner executables rather than process arguments', async () => {
    const fakeBin = await makeHome()
    const executable = async (name: string, source: string) => {
      const path = join(fakeBin, name)
      await writeFile(path, source)
      await chmod(path, 0o755)
    }
    await executable('uname', '#!/usr/bin/env bash\nprintf "Darwin\\n"\n')
    await executable(
      'ps',
      `#!/usr/bin/env bash
case "$*" in
  'ax -o comm=')
    printf '/opt/actions/Runner.Worker\\n'
    printf 'Runner.Worker\\n'
    printf '/opt/actions/Runner.Listener\\n'
    printf 'awk Runner.Worker Runner.Listener\\n'
    ;;
esac
`,
    )

    const { stdout } = await execFileAsync('bash', [diagnosticsScript], {
      env: {
        ...process.env,
        LC_ALL: 'C',
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
      },
      maxBuffer: 1024 * 1024,
    })

    expect(stdout).toContain('Runner.Worker count: 2')
    expect(stdout).toContain('Runner.Listener count: 1')
    expect(stdout).not.toContain('Runner.Worker count: 3')
    expect(stdout).not.toContain('Runner.Listener count: 2')
  })
})
