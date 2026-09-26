import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from './index.mts'
import { parseGhaArtifactsCleanup } from './parse-gha-artifacts-cleanup.mts'
import { parseGhaRuntimeAudit } from './parse-gha-runtime-audit.mts'
import { parseHttpOrigin, parseRunnerPortPolicy } from './parse-options.mts'
import { parseCli, parseCommandHelp } from './parse.mts'
import { commandNames, commandUsage } from './usage.mts'

describe('subcommand help', () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => {
    stdout.mockClear()
    stderr.mockClear()
  })

  it('prints that command usage for --help and -h and exits 0', () => {
    for (const command of commandNames()) {
      stdout.mockClear()
      stderr.mockClear()
      expect(parseCli(['node', 'vouchington', command, '--help'])).toEqual({
        kind: 'command-help',
        command,
      })
      expect(parseCli(['node', 'vouchington', command, '-h'])).toEqual({
        kind: 'command-help',
        command,
      })
      expect(runCli(['node', 'vouchington', command, '--help'])).toBe(0)
      expect(stdout.mock.calls.at(-1)?.[0]).toBe(commandUsage(command))
      expect(stderr).not.toHaveBeenCalled()
    }
    expect(commandUsage('gha-runtime-audit')).toContain('--pr-workflow')
    expect(commandUsage('gha-artifacts-cleanup')).toContain('sweep')
    expect(commandUsage('with-host-lock')).toContain('--name')
    expect(commandUsage('with-host-lock')).not.toContain('agent-harness-config')
    expect(commandUsage('retrospective-facts')).toContain('--pr')
    expect(commandUsage('retrospective-transcript')).toContain('--session-id')
    expect(() => commandUsage('nope')).toThrow('unknown command: nope')
    const missing = 'Commands:\n  gamma   Gamma\n   \n\nOptions:\n\n'
    expect(commandNames(missing)).toEqual(['gamma'])
    expect(() => commandUsage('gamma', missing)).toThrow('no usage for gamma')
  })

  it('ignores help when the command is missing, unknown, or after --', () => {
    expect(parseCommandHelp(undefined, ['--help'])).toBeUndefined()
    expect(parseCommandHelp('nope', ['--help'])).toBeUndefined()
    expect(parseCommandHelp('post-review', [])).toBeUndefined()
    expect(parseCommandHelp('post-review', ['-h'])).toEqual({
      kind: 'command-help',
      command: 'post-review',
    })
  })

  it('keeps parser-level help reachable when the dispatcher does not intercept it', () => {
    for (const flag of ['--help', '-h']) {
      expect(parseGhaRuntimeAudit([flag])).toEqual({ kind: 'help' })
      expect(parseGhaArtifactsCleanup([flag])).toEqual({ kind: 'help' })
      expect(parseGhaArtifactsCleanup(['run', flag])).toEqual({ kind: 'help' })
      expect(parseHttpOrigin([flag])).toEqual({ kind: 'help' })
      expect(parseRunnerPortPolicy([flag])).toEqual({ kind: 'help' })
    }
  })

  it('leaves help after -- for the child command', () => {
    expect(parseCli(['node', 'vouchington', 'with-host-lock', '--', '--help'])).toEqual({
      kind: 'with-host-lock',
      args: ['--', '--help'],
    })
    expect(parseCli(['node', 'vouchington', 'retrospective-facts', '--pr', '1', '--help'])).toEqual(
      {
        kind: 'command-help',
        command: 'retrospective-facts',
      },
    )
  })
})
