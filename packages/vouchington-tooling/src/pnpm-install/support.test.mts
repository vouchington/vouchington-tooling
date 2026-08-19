import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findWorkspaceLinkMismatches,
  listWorkspaces,
  logWorkspaceLinkMismatches,
  parseInstallOptions,
  reportGlibcVersionRuntime,
} from './support.mts'

const required = ['--runner-lifecycle', 'persistent', '--install-scripts', 'true']

describe('parseInstallOptions', () => {
  it('parses defaults and rejects malformed argv', () => {
    expect(parseInstallOptions(required)).toEqual({
      commandTimeoutSeconds: 120,
      ephemeralWorkspaces: '',
      installScripts: true,
      maxAttempts: 3,
      runnerLifecycle: 'persistent',
    })
    expect(() => parseInstallOptions(['--runner-lifecycle'])).toThrow('usage:')
    expect(() => parseInstallOptions([...required, '--wat', '1'])).toThrow('usage:')
    expect(() => parseInstallOptions([...required, '--runner-lifecycle', 'persistent'])).toThrow(
      'usage:',
    )
    expect(() =>
      parseInstallOptions(['--runner-lifecycle', 'other', '--install-scripts', 'true']),
    ).toThrow('usage:')
    expect(() =>
      parseInstallOptions(['--runner-lifecycle', 'persistent', '--install-scripts', 'yes']),
    ).toThrow('usage:')
    expect(() => parseInstallOptions([...required, '--max-attempts', '0'])).toThrow(
      '--max-attempts must be a positive integer',
    )
    expect(() => parseInstallOptions([...required, '--command-timeout-seconds', '-1'])).toThrow(
      '--command-timeout-seconds must be a nonnegative integer',
    )
  })
})

describe('workspace listing', () => {
  it('rejects invalid pnpm m ls output', async () => {
    await expect(
      listWorkspaces(async () => ({ code: 1, output: '', errorOutput: 'boom' })),
    ).rejects.toThrow('pnpm m ls failed: boom')
    await expect(listWorkspaces(async () => ({ code: 1, output: '' }))).rejects.toThrow(
      'unknown error',
    )
    await expect(listWorkspaces(async () => ({ code: 0, output: '{' }))).rejects.toThrow(
      'invalid workspace JSON',
    )
    await expect(listWorkspaces(async () => ({ code: 0, output: '[]' }))).rejects.toThrow(
      'invalid or empty workspace list',
    )
    await expect(
      listWorkspaces(async () => ({ code: 0, output: JSON.stringify([{ name: 'x' }]) })),
    ).rejects.toThrow('invalid workspace list')
  })

  it('reports missing workspace links and logs mismatches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-links-'))
    const workspace = join(root, 'pkg')
    await mkdir(workspace)
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'pkg',
        dependencies: { dep: 'workspace:*', skipped: 1 },
      }),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const mismatches = await findWorkspaceLinkMismatches(async () => ({
        code: 0,
        output: JSON.stringify([{ name: 'pkg', path: workspace }]),
      }))
      expect(mismatches).toEqual([
        expect.objectContaining({ actual: 'unknown workspace', dependency: 'dep' }),
      ])
      logWorkspaceLinkMismatches(mismatches)
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
      await rm(root, { force: true, recursive: true })
    }
  })
})

describe('reportGlibcVersionRuntime', () => {
  it('reads a string glibc version and ignores other shapes', () => {
    expect(reportGlibcVersionRuntime(undefined)).toBe('')
    expect(reportGlibcVersionRuntime({})).toBe('')
    expect(reportGlibcVersionRuntime({ header: null })).toBe('')
    expect(reportGlibcVersionRuntime({ header: {} })).toBe('')
    expect(reportGlibcVersionRuntime({ header: { glibcVersionRuntime: 1 } })).toBe('')
    expect(reportGlibcVersionRuntime({ header: { glibcVersionRuntime: '2.39' } })).toBe('2.39')
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
