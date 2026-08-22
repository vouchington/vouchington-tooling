import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { assertWorkflowCommandDrift, parseCiLocalArgs, runCiLocal } from './index.mts'
import type { CiLocalSpawn, CiLocalTarget } from './types.mts'

const TARGETS: Record<string, CiLocalTarget> = {
  lint: {
    description: 'run lint',
    commands: [
      {
        command: 'echo lint',
        description: 'lint sources',
        env: { TOKEN: 'secret', EMPTY: undefined },
        source: { workflow: '.github/workflows/test.yml', contains: 'echo lint' },
      },
      {
        command: 'echo extra',
        description: 'no workflow source',
      },
    ],
  },
  typecheck: {
    description: 'run typecheck',
    commands: [{ command: 'echo types', description: 'typecheck' }],
  },
}

function collect() {
  const chunks: string[] = []
  return {
    chunks,
    write(chunk: string) {
      chunks.push(chunk)
    },
    text() {
      return chunks.join('')
    },
  }
}

describe('ci-local', () => {
  const testDirs: string[] = []

  afterEach(async () => {
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
    vi.restoreAllMocks()
  })

  async function makeWorkflowRepo(contents: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'ci-local-'))
    testDirs.push(dir)
    await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
    await writeFile(join(dir, '.github', 'workflows', 'test.yml'), contents)
    return dir
  }

  it('parses help, list, dry-run, and a known target', () => {
    const names = ['lint', 'typecheck'] as const
    expect(parseCiLocalArgs(['--help'], names)).toEqual({ dryRun: false, help: true, list: false })
    expect(parseCiLocalArgs(['-h'], names)).toEqual({ dryRun: false, help: true, list: false })
    expect(parseCiLocalArgs(['--list'], names)).toEqual({ dryRun: false, help: false, list: true })
    expect(parseCiLocalArgs(['lint', '--dry-run'], names)).toEqual({
      dryRun: true,
      help: false,
      list: false,
      target: 'lint',
    })
    expect(parseCiLocalArgs(['lint'], names)).toEqual({
      dryRun: false,
      help: false,
      list: false,
      target: 'lint',
    })
  })

  it('rejects mixed help, duplicate flags, unknown flags, and invalid target combinations', () => {
    const names = ['lint', 'typecheck'] as const
    expect(() => parseCiLocalArgs(['--help', 'lint'], names)).toThrow('help must be used by itself')
    expect(() => parseCiLocalArgs(['--dry-run', '--dry-run'], names)).toThrow(
      'Options may only be specified once.',
    )
    expect(() => parseCiLocalArgs(['--list', '--list'], names)).toThrow(
      'Options may only be specified once.',
    )
    expect(() => parseCiLocalArgs(['--wat'], names)).toThrow()
    expect(() => parseCiLocalArgs(['lint', 'typecheck'], names)).toThrow(
      'Only one target may be specified.',
    )
    expect(() => parseCiLocalArgs(['--list', 'lint'], names)).toThrow(
      '--list must be used by itself.',
    )
    expect(() => parseCiLocalArgs(['--list', '--dry-run'], names)).toThrow(
      '--list must be used by itself.',
    )
    expect(() => parseCiLocalArgs(['--dry-run'], names)).toThrow('--dry-run requires a target.')
    expect(() => parseCiLocalArgs(['other'], names)).toThrow(
      'Unknown target "other". Valid targets: lint, typecheck',
    )
  })

  it('wraps non-Error parseArgs failures', () => {
    expect(() =>
      parseCiLocalArgs(['--list'], ['lint'], () => {
        throw 'bad flag'
      }),
    ).toThrow('bad flag')
  })

  it('fails drift detection when a registered workflow command is absent', async () => {
    const dir = await makeWorkflowRepo('name: test\n')
    const target: CiLocalTarget = {
      description: 'test',
      commands: [
        {
          command: 'echo local',
          description: 'local test',
          source: { workflow: '.github/workflows/test.yml', contains: 'echo remote' },
        },
      ],
    }

    expect(() => assertWorkflowCommandDrift({ lint: target }, dir)).toThrow(
      'ci-local drift: local test command was not found',
    )
  })

  it('checks every expected workflow command when drift detection has multiple source lines', async () => {
    const dir = await makeWorkflowRepo('echo first\n')
    const target: CiLocalTarget = {
      description: 'test',
      commands: [
        {
          command: 'echo first && echo second',
          description: 'multi-line drift test',
          source: {
            workflow: '.github/workflows/test.yml',
            contains: ['echo first', 'echo second'],
          },
        },
      ],
    }

    expect(() => assertWorkflowCommandDrift({ lint: target }, dir)).toThrow(
      'ci-local drift: multi-line drift test command was not found',
    )
    await writeFile(join(dir, '.github', 'workflows', 'test.yml'), 'echo first\necho second\n')
    expect(() => assertWorkflowCommandDrift({ lint: target }, dir)).not.toThrow()
    expect(() =>
      assertWorkflowCommandDrift({
        lint: { description: 'skip', commands: [{ command: 'echo', description: 'no source' }] },
      }),
    ).not.toThrow()
  })

  it('lists targets, prints help, and dry-runs without spawning', async () => {
    const cwd = await makeWorkflowRepo('echo lint\n')
    const stdout = collect()
    const stderr = collect()
    const spawn = vi.fn<CiLocalSpawn>(() => ({ status: 0 }))

    expect(
      runCiLocal({
        args: ['--help'],
        targets: TARGETS,
        cwd,
        spawn,
        stdout,
        stderr,
        usage: 'Usage: custom',
      }),
    ).toBe(0)
    expect(stdout.text()).toContain('Usage: custom')

    stdout.chunks.length = 0
    expect(runCiLocal({ args: ['--list'], targets: TARGETS, cwd, spawn, stdout, stderr })).toBe(0)
    expect(stdout.text()).toContain('lint - run lint')
    expect(stdout.text()).toContain('typecheck - run typecheck')

    stdout.chunks.length = 0
    expect(runCiLocal({ args: [], targets: TARGETS, cwd, spawn, stdout, stderr })).toBe(0)
    expect(stdout.text()).toContain('lint - run lint')

    stdout.chunks.length = 0
    expect(
      runCiLocal({ args: ['lint', '--dry-run'], targets: TARGETS, cwd, spawn, stdout, stderr }),
    ).toBe(0)
    expect(stdout.text()).toContain('lint: run lint')
    expect(stdout.text()).toContain('env TOKEN bash -c "echo lint"')
    expect(stdout.text()).toContain('$ echo extra')
    expect(stdout.text()).not.toContain('secret')
    expect(stdout.text()).not.toContain('EMPTY=')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('runs injected commands, preserves nonzero status, and reports spawn errors', async () => {
    const cwd = await makeWorkflowRepo('echo lint\n')
    const stdout = collect()
    const stderr = collect()
    const spawn = vi
      .fn<CiLocalSpawn>()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 9 })

    expect(runCiLocal({ args: ['lint'], targets: TARGETS, cwd, spawn, stdout, stderr })).toBe(9)
    expect(spawn).toHaveBeenCalledWith(
      '/bin/bash',
      ['-c', 'echo lint'],
      expect.objectContaining({ cwd, stdio: 'inherit' }),
    )
    expect(spawn.mock.calls[0]?.[2].env).toMatchObject({ TOKEN: 'secret' })

    spawn.mockReset()
    spawn.mockReturnValue({ status: null })
    expect(runCiLocal({ args: ['typecheck'], targets: TARGETS, cwd, spawn, stdout, stderr })).toBe(
      1,
    )

    stderr.chunks.length = 0
    spawn.mockReset()
    spawn.mockReturnValue({ error: new Error('spawn failed'), status: null })
    expect(runCiLocal({ args: ['lint'], targets: TARGETS, cwd, spawn, stdout, stderr })).toBe(1)
    expect(stderr.text()).toContain('spawn failed')

    stderr.chunks.length = 0
    spawn.mockReset()
    spawn.mockImplementation(() => {
      throw 'boom'
    })
    expect(runCiLocal({ args: ['lint'], targets: TARGETS, cwd, spawn, stdout, stderr })).toBe(1)
    expect(stderr.text()).toContain('boom')

    stderr.chunks.length = 0
    expect(runCiLocal({ args: ['missing'], targets: TARGETS, cwd, spawn, stdout, stderr })).toBe(1)
    expect(stderr.text()).toContain('Unknown target "missing"')
  })

  it('uses process streams, cwd, usage, and spawn when extras are omitted', () => {
    expect(runCiLocal({ args: ['--help'], targets: { lint: TARGETS.lint! } })).toBe(0)
    expect(
      runCiLocal({
        args: ['typecheck', '--dry-run'],
        targets: { typecheck: TARGETS.typecheck! },
        cwd: process.cwd(),
      }),
    ).toBe(0)
  })

  it('runs the default spawn wrapper for a successful command', async () => {
    const cwd = await makeWorkflowRepo('true\n')
    const stdout = collect()
    const stderr = collect()
    expect(
      runCiLocal({
        args: ['ok'],
        targets: {
          ok: { description: 'succeed', commands: [{ command: 'true', description: 'true' }] },
        },
        cwd,
        stdout,
        stderr,
      }),
    ).toBe(0)
  })
})
