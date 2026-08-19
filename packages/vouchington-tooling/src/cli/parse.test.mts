import { describe, expect, it } from 'vitest'
import { parseCli } from './parse.mts'

describe('parseCli', () => {
  it('treats empty argv, -h, and --help as help', () => {
    expect(parseCli(['node', 'vouchington'])).toEqual({ kind: 'help' })
    expect(parseCli(['node', 'vouchington', '-h'])).toEqual({ kind: 'help' })
    expect(parseCli(['node', 'vouchington', '--help'])).toEqual({ kind: 'help' })
  })

  it('parses version flags', () => {
    expect(parseCli(['node', 'vouchington', '-v'])).toEqual({ kind: 'version' })
    expect(parseCli(['node', 'vouchington', '--version'])).toEqual({ kind: 'version' })
  })

  it('rejects an unknown command', () => {
    expect(parseCli(['node', 'vouchington', 'nope'])).toEqual({
      kind: 'error',
      message: 'unknown command: nope',
    })
  })

  it('parses runner-port-policy flags', () => {
    expect(parseCli(['node', 'vouchington', 'runner-port-policy'])).toEqual({
      kind: 'runner-port-policy',
    })
    expect(parseCli(['node', 'vouchington', 'runner-port-policy', '--file', 'p.json'])).toEqual({
      kind: 'runner-port-policy',
      file: 'p.json',
    })
    expect(parseCli(['node', 'vouchington', 'runner-port-policy', '--reserved', '2200'])).toEqual({
      kind: 'runner-port-policy',
      reserved: 2200,
    })
    expect(parseCli(['node', 'vouchington', 'runner-port-policy', '--help'])).toEqual({
      kind: 'help',
    })
  })

  it('rejects invalid runner-port-policy options', () => {
    expect(parseCli(['node', 'vouchington', 'runner-port-policy', '--file'])).toEqual({
      kind: 'error',
      message: '--file requires a path',
    })
    expect(parseCli(['node', 'vouchington', 'runner-port-policy', '--reserved'])).toEqual({
      kind: 'error',
      message: '--reserved requires a port',
    })
    expect(parseCli(['node', 'vouchington', 'runner-port-policy', '--reserved', 'nope'])).toEqual({
      kind: 'error',
      message: '--reserved must be an integer',
    })
    expect(parseCli(['node', 'vouchington', 'runner-port-policy', '--wat'])).toEqual({
      kind: 'error',
      message: 'unknown runner-port-policy option: --wat',
    })
  })

  it('forwards with-host-lock arguments', () => {
    expect(
      parseCli(['node', 'vouchington', 'with-host-lock', '--name', 'build', '--', 'true']),
    ).toEqual({
      kind: 'with-host-lock',
      args: ['--name', 'build', '--', 'true'],
    })
  })

  it('parses gha-runtime-audit workflow filters', () => {
    expect(
      parseCli([
        'node',
        'vouchington',
        'gha-runtime-audit',
        '--repository',
        'owner/repo',
        '--branch',
        'main',
        '--pr-workflow',
        'CI',
        '--push-workflow',
        '/^Main CI \\(.+\\)$/',
      ]),
    ).toEqual({
      kind: 'gha-runtime-audit',
      repository: 'owner/repo',
      branch: 'main',
      workflows: [
        { name: 'CI', event: 'pull_request' },
        { name: /^Main CI \(.+\)$/, event: 'push' },
      ],
    })
    expect(parseCli(['node', 'vouchington', 'gha-runtime-audit', '--help'])).toEqual({
      kind: 'help',
    })
  })

  it('rejects invalid gha-runtime-audit options', () => {
    expect(parseCli(['node', 'vouchington', 'gha-runtime-audit'])).toEqual({
      kind: 'error',
      message: 'gha-runtime-audit requires --pr-workflow or --push-workflow',
    })
    expect(parseCli(['node', 'vouchington', 'gha-runtime-audit', '--pr-workflow'])).toEqual({
      kind: 'error',
      message: '--pr-workflow requires a value',
    })
    expect(parseCli(['node', 'vouchington', 'gha-runtime-audit', '--wat'])).toEqual({
      kind: 'error',
      message: 'unknown gha-runtime-audit option: --wat',
    })
  })
})
