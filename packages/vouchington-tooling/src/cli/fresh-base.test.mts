import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../fresh-base/index.mts', () => ({ checkFreshBase: vi.fn() }))

import { checkFreshBase } from '../fresh-base/index.mts'
import { runFreshBase } from './commands/fresh-base.mts'
import { runCli } from './index.mts'
import { parseCli } from './parse.mts'

describe('fresh-base command', () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => {
    stdout.mockClear()
    stderr.mockClear()
    vi.mocked(checkFreshBase).mockReset()
  })

  it('parses defaults, flags, and rejects unknown options', () => {
    expect(parseCli(['node', 'vouchington', 'fresh-base'])).toEqual({
      kind: 'fresh-base',
      skipFetch: false,
    })
    expect(
      parseCli([
        'node',
        'vouchington',
        'fresh-base',
        '--skip-fetch',
        '--remote',
        'o',
        '--branch',
        'b',
      ]),
    ).toEqual({ kind: 'fresh-base', skipFetch: true, remote: 'o', branch: 'b' })
    expect(parseCli(['node', 'vouchington', 'fresh-base', '--nope', 'x'])).toEqual({
      kind: 'error',
      message: 'unknown fresh-base option: --nope',
    })
  })

  it('dispatches from the CLI entry point', () => {
    vi.mocked(checkFreshBase).mockReturnValueOnce(null)
    expect(runCli(['node', 'vouchington', 'fresh-base', '--skip-fetch'])).toBe(0)
    expect(checkFreshBase).toHaveBeenCalledWith(expect.objectContaining({ skipFetch: true }))
  })

  it('prints the JSON report, nothing outside a repository, and git-name errors', () => {
    vi.mocked(checkFreshBase).mockReturnValueOnce({ status: 'behind' } as never)
    expect(runFreshBase({ skipFetch: true })).toBe(0)
    expect(checkFreshBase).toHaveBeenCalledWith(expect.objectContaining({ skipFetch: true }))
    expect(stdout).toHaveBeenCalledWith('{"status":"behind"}\n')
    stdout.mockClear()
    vi.mocked(checkFreshBase).mockReturnValueOnce(null)
    expect(runFreshBase({ skipFetch: false })).toBe(0)
    expect(stdout).not.toHaveBeenCalled()
    vi.mocked(checkFreshBase).mockImplementationOnce(() => {
      throw new Error('remote must be a non-option Git name')
    })
    expect(runFreshBase({ skipFetch: false, remote: '-c' })).toBe(1)
    expect(stderr).toHaveBeenCalledWith('remote must be a non-option Git name\n')
    vi.mocked(checkFreshBase).mockImplementationOnce(() => {
      throw 'boom'
    })
    expect(runFreshBase({ skipFetch: false })).toBe(1)
    expect(stderr).toHaveBeenCalledWith('boom\n')
  })
})
