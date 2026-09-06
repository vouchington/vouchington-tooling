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

    // Runs the real (unshimmed) platform branch -- Linux in CI, Darwin on a
    // dev machine -- so this is the only place the genuine `load1 per cpu`
    // computation is exercised. A value-or-unavailable shape assertion, not a
    // Darwin-only one: it must hold on whichever real platform this runs on.
    expect(stdout).toMatch(/load1 per cpu: (?:unavailable|\d+\.\d{2})/)

    // Contract: every `== section ==` has a non-empty body -- either real
    // data or an explicit "unavailable" line, never silence.
    const chunks = stdout.split('\n== ').slice(1)
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      const [header, ...rest] = chunk.split('\n')
      expect(rest.join('\n').trim().length, `section "${header}" had no body`).toBeGreaterThan(0)
    }
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

  it('quantifies Darwin load, cpu, and memory pressure when every signal is present', async () => {
    const fakeBin = await makeHome()
    const executable = async (name: string, source: string) => {
      const path = join(fakeBin, name)
      await writeFile(path, source)
      await chmod(path, 0o755)
    }
    await executable('uname', '#!/usr/bin/env bash\nprintf "Darwin\\n"\n')
    await executable(
      'sysctl',
      `#!/usr/bin/env bash
case "$*" in
  '-n hw.memsize') printf '103079215104\\n' ;;
  'vm.swapusage') printf '%s\\n' 'vm.swapusage: total = 13312.00M used = 100.00M free = 13212.00M (encrypted)' ;;
  '-n vm.loadavg') printf '{ 11.58 14.61 13.91 }\\n' ;;
  '-n hw.logicalcpu') printf '28\\n' ;;
  '-n hw.physicalcpu') printf '28\\n' ;;
  '-n hw.ncpu') printf '28\\n' ;;
  '-n hw.perflevel0.logicalcpu') printf '20\\n' ;;
  '-n hw.perflevel1.logicalcpu') printf '8\\n' ;;
  '-n kern.memorystatus_vm_pressure_level') printf '1\\n' ;;
  '-n vm.compressor_bytes_used') printf '8885767232\\n' ;;
  *) exit 1 ;;
esac
`,
    )
    await executable(
      'memory_pressure',
      `#!/usr/bin/env bash
case "$*" in
  '-Q')
    printf '%s\\n' 'The system has 103079215104 (6291456 pages with a page size of 16384).'
    printf '%s\\n' 'System-wide memory free percentage: 81%'
    ;;
esac
`,
    )
    await executable(
      'iostat',
      `#!/usr/bin/env bash
case "$*" in
  '-c 2')
    printf '%s\\n' '              disk0       cpu    load average'
    printf '%s\\n' '    KB/t  tps  MB/s  us sy id   1m   5m   15m'
    printf '%s\\n' '   14.06 3578 49.12  18 15 68  11.58 14.61 13.91'
    ;;
esac
`,
    )
    await executable(
      'ps',
      `#!/usr/bin/env bash
case "$*" in
  'ax -o pid= -o rss= -o comm=')
    printf '  123  4096 /usr/bin/foo\\n'
    printf '  456  2048 /usr/bin/bar\\n'
    ;;
  'ax -o comm=')
    printf '/opt/actions/Runner.Worker\\n'
    printf '/opt/actions/Runner.Listener\\n'
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

    expect(stdout).toContain('== load and cpu ==')
    expect(stdout).toContain('load average: 11.58 14.61 13.91')
    expect(stdout).toContain('load1 per cpu: 0.41')
    expect(stdout).toContain('hw.perflevel0.logicalcpu: 20')
    expect(stdout).toContain('hw.perflevel1.logicalcpu: 8')
    expect(stdout).toContain('== memory pressure ==')
    expect(stdout).toContain('System-wide memory free percentage: 81%')
    expect(stdout).toContain('kern.memorystatus_vm_pressure_level: normal (1)')
    expect(stdout).toContain('vm.compressor_bytes_used: 8885767232')
  })

  it('reports explicit unavailable markers instead of empty sections or false zeros on Darwin', async () => {
    const fakeBin = await makeHome()
    // Resolve absolute paths up front: PATH below is restricted to exactly
    // fakeBin, so every shim must use an absolute-path shebang (not
    // `/usr/bin/env bash`, which itself needs a PATH lookup) and the
    // top-level bash invocation must not rely on PATH resolution either.
    const { stdout: bashPathRaw } = await execFileAsync('which', ['bash'])
    const { stdout: awkPathRaw } = await execFileAsync('which', ['awk'])
    const { stdout: sortPathRaw } = await execFileAsync('which', ['sort'])
    const { stdout: sedPathRaw } = await execFileAsync('which', ['sed'])
    const bashPath = bashPathRaw.trim()
    const executable = async (name: string, source: string) => {
      const path = join(fakeBin, name)
      await writeFile(path, `#!${bashPath}\n${source}`)
      await chmod(path, 0o755)
    }
    await executable('awk', `exec '${awkPathRaw.trim()}' "$@"\n`)
    await executable('sort', `exec '${sortPathRaw.trim()}' "$@"\n`)
    await executable('sed', `exec '${sedPathRaw.trim()}' "$@"\n`)
    await executable('uname', 'printf "Darwin\\n"\n')
    // No sysctl, memory_pressure, iostat, uptime, or vm_stat shim: PATH below
    // is restricted to exactly this directory, so those binaries -- and any
    // `timeout` -- are guaranteed unresolvable regardless of the host running
    // this test (a real Mac would otherwise resolve the genuine ones).
    await executable(
      'ps',
      `case "$*" in
  'ax -o pid= -o rss= -o comm=') exit 0 ;;
  'ax -o comm=') exit 0 ;;
esac
`,
    )

    const { stdout } = await execFileAsync(bashPath, [diagnosticsScript], {
      env: { LC_ALL: 'C', PATH: fakeBin },
      maxBuffer: 1024 * 1024,
    })

    expect(stdout).toContain('load1 per cpu: unavailable')
    expect(stdout).toContain('iostat unavailable')
    expect(stdout).toContain('memory_pressure unavailable')
    expect(stdout).toContain('kern.memorystatus_vm_pressure_level: unavailable')
    expect(stdout).toContain('unavailable: top rss processes')
    expect(stdout).toContain('unavailable: process list')
    expect(stdout).not.toContain('Runner.Worker count: 0')

    // Contract: every `== section ==` has a non-empty body -- either real
    // data or an explicit "unavailable" line, never silence.
    const chunks = stdout.split('\n== ').slice(1)
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      const [header, ...rest] = chunk.split('\n')
      expect(rest.join('\n').trim().length, `section "${header}" had no body`).toBeGreaterThan(0)
    }
  })

  it.runIf(process.platform === 'darwin')(
    'quantifies real Darwin load, cpu, and memory pressure without an empty section',
    async () => {
      const { stdout } = await execFileAsync('bash', [diagnosticsScript], {
        env: { ...process.env, LC_ALL: 'C' },
        maxBuffer: 1024 * 1024,
      })

      expect(stdout).toContain('== load and cpu ==')
      expect(stdout).toContain('== memory pressure ==')
      expect(stdout).toMatch(/load1 per cpu: (?:unavailable|\d+\.\d{2})/)
      expect(stdout).toMatch(
        /kern\.memorystatus_vm_pressure_level: (?:unavailable|normal \(1\)|warning \(2\)|critical \(4\)|unknown \(.+\))/,
      )

      // Deliberately never assert a specific metric is *available*: the
      // GitHub-hosted macOS image's architecture decides whether
      // hw.perflevel* resolves at all. The contract is value-or-unavailable.
      const chunks = stdout.split('\n== ').slice(1)
      expect(chunks.length).toBeGreaterThan(0)
      for (const chunk of chunks) {
        const [header, ...rest] = chunk.split('\n')
        expect(rest.join('\n').trim().length, `section "${header}" had no body`).toBeGreaterThan(0)
      }
    },
  )
})
