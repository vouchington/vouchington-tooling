import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { runCheckRunCli } from './cli.mts'
import type { GhExec } from '../gha-post-review/github.mts'

const HEAD_SHA = 'd'.repeat(40)

function withOutputFile<T>(run: (outputPath: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'gha-check-run-cli-'))
  const outputPath = join(dir, 'output')
  writeFileSync(outputPath, '')
  try {
    return run(outputPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function makeExec(handler: (args: readonly string[]) => string): GhExec {
  return (args) => handler(args)
}

const CREATE_ENV_BASE = {
  GITHUB_REPOSITORY: 'o/r',
  CHECK_NAME: 'Claude Code Review',
  HEAD_SHA,
  TITLE: 'title',
  SUMMARY: 'summary',
}

describe('runCheckRunCli create', () => {
  it('creates an in_progress check run and appends check_run_id to GITHUB_OUTPUT', () => {
    withOutputFile((outputPath) => {
      const exec = makeExec(() => JSON.stringify({ id: 55 }))
      const code = runCheckRunCli(
        ['node', 'cli.mts', 'create'],
        { ...CREATE_ENV_BASE, STATUS: 'in_progress', GITHUB_OUTPUT: outputPath },
        exec,
      )
      expect(code).toBe(0)
      expect(readFileSync(outputPath, 'utf8')).toBe('check_run_id=55\n')
    })
  })

  it('creates a completed check run with conclusion success', () => {
    withOutputFile((outputPath) => {
      const exec = makeExec(() => JSON.stringify({ id: 1 }))
      const code = runCheckRunCli(
        ['node', 'cli.mts', 'create'],
        {
          ...CREATE_ENV_BASE,
          STATUS: 'completed',
          CONCLUSION: 'success',
          GITHUB_OUTPUT: outputPath,
        },
        exec,
      )
      expect(code).toBe(0)
      expect(readFileSync(outputPath, 'utf8')).toBe('check_run_id=1\n')
    })
  })

  it('creates a completed check run with conclusion neutral', () => {
    withOutputFile((outputPath) => {
      const exec = makeExec(() => JSON.stringify({ id: 2 }))
      const code = runCheckRunCli(
        ['node', 'cli.mts', 'create'],
        {
          ...CREATE_ENV_BASE,
          STATUS: 'completed',
          CONCLUSION: 'neutral',
          GITHUB_OUTPUT: outputPath,
        },
        exec,
      )
      expect(code).toBe(0)
      expect(readFileSync(outputPath, 'utf8')).toBe('check_run_id=2\n')
    })
  })

  it('does not write to GITHUB_OUTPUT when it is unset', () => {
    const exec = makeExec(() => JSON.stringify({ id: 3 }))
    const code = runCheckRunCli(
      ['node', 'cli.mts', 'create'],
      { ...CREATE_ENV_BASE, STATUS: 'in_progress' },
      exec,
    )
    expect(code).toBe(0)
  })

  it('fails when STATUS is completed but CONCLUSION is missing', () => {
    const exec = makeExec(() => JSON.stringify({ id: 1 }))
    const code = runCheckRunCli(
      ['node', 'cli.mts', 'create'],
      { ...CREATE_ENV_BASE, STATUS: 'completed' },
      exec,
    )
    expect(code).toBe(1)
  })

  it('fails on an invalid STATUS value', () => {
    const exec = makeExec(() => JSON.stringify({ id: 1 }))
    const code = runCheckRunCli(
      ['node', 'cli.mts', 'create'],
      { ...CREATE_ENV_BASE, STATUS: 'queued' },
      exec,
    )
    expect(code).toBe(1)
  })

  it('fails on an invalid CONCLUSION value', () => {
    const exec = makeExec(() => JSON.stringify({ id: 1 }))
    const code = runCheckRunCli(
      ['node', 'cli.mts', 'create'],
      { ...CREATE_ENV_BASE, STATUS: 'completed', CONCLUSION: 'failure' },
      exec,
    )
    expect(code).toBe(1)
  })

  it('fails when a required env var is missing', () => {
    const exec = makeExec(() => JSON.stringify({ id: 1 }))
    const code = runCheckRunCli(['node', 'cli.mts', 'create'], { STATUS: 'in_progress' }, exec)
    expect(code).toBe(1)
  })

  it('fails cleanly when an invalid head sha is rejected by createCheckRun', () => {
    const exec = makeExec(() => JSON.stringify({ id: 1 }))
    const code = runCheckRunCli(
      ['node', 'cli.mts', 'create'],
      { ...CREATE_ENV_BASE, HEAD_SHA: 'bad-sha', STATUS: 'in_progress' },
      exec,
    )
    expect(code).toBe(1)
  })

  it('surfaces a gh exec failure as a clean non-throwing error exit', () => {
    const exec: GhExec = () => {
      throw new Error('gh: rate limited')
    }
    const code = runCheckRunCli(
      ['node', 'cli.mts', 'create'],
      { ...CREATE_ENV_BASE, STATUS: 'in_progress' },
      exec,
    )
    expect(code).toBe(1)
  })

  it('returns 1 and prints Error for a non-Error throw', () => {
    const exec: GhExec = () => {
      // oxlint-disable-next-line no-throw-literal -- exercise the non-Error fallback branch in the catch handler
      throw 'nope'
    }
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const code = runCheckRunCli(
        ['node', 'cli.mts', 'create'],
        { ...CREATE_ENV_BASE, STATUS: 'in_progress' },
        exec,
      )
      expect(code).toBe(1)
      expect(stderr).toHaveBeenCalledWith('Error: nope\n')
    } finally {
      stderr.mockRestore()
    }
  })
})

describe('runCheckRunCli complete', () => {
  it('is a deliberate no-op when CHECK_RUN_ID is empty', () => {
    let called = false
    const exec: GhExec = () => {
      called = true
      return ''
    }
    const code = runCheckRunCli(
      ['node', 'cli.mts', 'complete'],
      {
        CHECK_RUN_ID: '',
        GITHUB_REPOSITORY: 'o/r',
        CONCLUSION: 'success',
        TITLE: 't',
        SUMMARY: 's',
      },
      exec,
    )
    expect(code).toBe(0)
    expect(called).toBe(false)
  })

  it('is a deliberate no-op when CHECK_RUN_ID is unset', () => {
    const exec = makeExec(() => '')
    const code = runCheckRunCli(['node', 'cli.mts', 'complete'], {}, exec)
    expect(code).toBe(0)
  })

  it('completes a real check run id', () => {
    let seenPath = ''
    const exec = makeExec((args) => {
      seenPath = String(args[3])
      return ''
    })
    const code = runCheckRunCli(
      ['node', 'cli.mts', 'complete'],
      {
        CHECK_RUN_ID: '99',
        GITHUB_REPOSITORY: 'o/r',
        CONCLUSION: 'success',
        TITLE: 'Code Review complete — 3 findings',
        SUMMARY: 'done',
      },
      exec,
    )
    expect(code).toBe(0)
    expect(seenPath).toBe('repos/o/r/check-runs/99')
  })

  it('fails on an invalid CONCLUSION value', () => {
    const exec = makeExec(() => '')
    const code = runCheckRunCli(
      ['node', 'cli.mts', 'complete'],
      {
        CHECK_RUN_ID: '1',
        GITHUB_REPOSITORY: 'o/r',
        CONCLUSION: 'failure',
        TITLE: 't',
        SUMMARY: 's',
      },
      exec,
    )
    expect(code).toBe(1)
  })

  it('fails when a required env var is missing', () => {
    const exec = makeExec(() => '')
    const code = runCheckRunCli(['node', 'cli.mts', 'complete'], { CHECK_RUN_ID: '1' }, exec)
    expect(code).toBe(1)
  })
})

describe('runCheckRunCli subcommand dispatch', () => {
  it('fails on an unknown subcommand', () => {
    const exec = makeExec(() => '')
    const code = runCheckRunCli(['node', 'cli.mts', 'delete'], {}, exec)
    expect(code).toBe(1)
  })

  it('fails when no subcommand is given', () => {
    const exec = makeExec(() => '')
    const code = runCheckRunCli(['node', 'cli.mts'], {}, exec)
    expect(code).toBe(1)
  })
})
