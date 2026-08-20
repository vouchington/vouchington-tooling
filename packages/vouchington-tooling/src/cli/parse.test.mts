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

  it('forwards script, pnpm-install, and vitest-blob-manifest arguments', () => {
    expect(parseCli(['node', 'vouchington', 'gha-output', 'name'])).toEqual({
      kind: 'script',
      command: 'gha-output',
      args: ['name'],
    })
    expect(parseCli(['node', 'vouchington', 'gha-needs-results', 'jobs'])).toEqual({
      kind: 'script',
      command: 'gha-needs-results',
      args: ['jobs'],
    })
    expect(
      parseCli(['node', 'vouchington', 'download-with-diagnostics', 'https://x', 'out']),
    ).toEqual({
      kind: 'script',
      command: 'download-with-diagnostics',
      args: ['https://x', 'out'],
    })
    expect(parseCli(['node', 'vouchington', 'host-pressure-diagnostics'])).toEqual({
      kind: 'script',
      command: 'host-pressure-diagnostics',
      args: [],
    })
    expect(
      parseCli(['node', 'vouchington', 'allocate-browser-safe-ports', '2', '--policy', 'p.json']),
    ).toEqual({
      kind: 'script',
      command: 'allocate-browser-safe-ports',
      args: ['2', '--policy', 'p.json'],
    })
    expect(
      parseCli([
        'node',
        'vouchington',
        'pnpm-install',
        '--runner-lifecycle',
        'persistent',
        '--install-scripts',
        'true',
      ]),
    ).toEqual({
      kind: 'pnpm-install',
      args: ['--runner-lifecycle', 'persistent', '--install-scripts', 'true'],
    })
    expect(parseCli(['node', 'vouchington', 'vitest-blob-manifest', 'tooling'])).toEqual({
      kind: 'vitest-blob-manifest',
      args: ['tooling'],
    })
    expect(parseCli(['node', 'vouchington', 'diagnose-port-collision', '--ports', '2200'])).toEqual(
      {
        kind: 'script',
        command: 'diagnose-port-collision',
        args: ['--ports', '2200'],
      },
    )
    expect(parseCli(['node', 'vouchington', 'prepare-trivy-db'])).toEqual({
      kind: 'script',
      command: 'prepare-trivy-db',
      args: [],
    })
  })

  it('parses http-origin flags', () => {
    expect(parseCli(['node', 'vouchington', 'http-origin'])).toEqual({
      kind: 'http-origin',
      field: 'origin',
      value: '',
    })
    expect(
      parseCli(['node', 'vouchington', 'http-origin', '--field', 'cdn_origin', 'https://x.test']),
    ).toEqual({
      kind: 'http-origin',
      field: 'cdn_origin',
      value: 'https://x.test',
    })
    expect(parseCli(['node', 'vouchington', 'http-origin', '--', '--looks-like-flag'])).toEqual({
      kind: 'http-origin',
      field: 'origin',
      value: '--looks-like-flag',
    })
    expect(parseCli(['node', 'vouchington', 'http-origin', '--help'])).toEqual({ kind: 'help' })
    expect(parseCli(['node', 'vouchington', 'http-origin', '--field'])).toEqual({
      kind: 'error',
      message: '--field requires a name',
    })
    expect(parseCli(['node', 'vouchington', 'http-origin', '--wat'])).toEqual({
      kind: 'error',
      message: 'unknown http-origin option: --wat',
    })
    expect(parseCli(['node', 'vouchington', 'http-origin', 'a', 'b'])).toEqual({
      kind: 'error',
      message: 'http-origin accepts at most one value',
    })
  })

  it('parses gha-artifacts-cleanup subcommands', () => {
    expect(
      parseCli([
        'node',
        'vouchington',
        'gha-artifacts-cleanup',
        'run',
        '--run-id',
        '42',
        '--keep-pattern',
        'plan-*',
        '--delete-pattern',
        'coverage-*',
        '--patterns-file',
        'patterns.json',
      ]),
    ).toEqual({
      kind: 'gha-artifacts-cleanup',
      subcommand: 'run',
      runId: '42',
      keepPatterns: ['plan-*'],
      deletePatterns: ['coverage-*'],
      patternsFile: 'patterns.json',
    })
    expect(
      parseCli([
        'node',
        'vouchington',
        'gha-artifacts-cleanup',
        'sweep',
        '--older-than-hours',
        '6',
      ]),
    ).toEqual({
      kind: 'gha-artifacts-cleanup',
      subcommand: 'sweep',
      olderThanHours: 6,
      keepPatterns: [],
      deletePatterns: [],
    })
    expect(
      parseCli([
        'node',
        'vouchington',
        'gha-artifacts-cleanup',
        'sweep',
        '--older-than-hours',
        '6',
        '--patterns-file',
        'patterns.json',
      ]),
    ).toEqual({
      kind: 'gha-artifacts-cleanup',
      subcommand: 'sweep',
      olderThanHours: 6,
      keepPatterns: [],
      deletePatterns: [],
      patternsFile: 'patterns.json',
    })
    expect(parseCli(['node', 'vouchington', 'gha-artifacts-cleanup', '--help'])).toEqual({
      kind: 'help',
    })
    expect(parseCli(['node', 'vouchington', 'gha-artifacts-cleanup', 'run', '--help'])).toEqual({
      kind: 'help',
    })
  })

  it('rejects invalid gha-artifacts-cleanup options', () => {
    expect(parseCli(['node', 'vouchington', 'gha-artifacts-cleanup'])).toEqual({
      kind: 'error',
      message: 'gha-artifacts-cleanup requires run or sweep',
    })
    expect(parseCli(['node', 'vouchington', 'gha-artifacts-cleanup', 'bogus'])).toEqual({
      kind: 'error',
      message: 'unknown gha-artifacts-cleanup subcommand: bogus',
    })
    expect(parseCli(['node', 'vouchington', 'gha-artifacts-cleanup', 'run'])).toEqual({
      kind: 'error',
      message: 'gha-artifacts-cleanup run requires --run-id',
    })
    expect(parseCli(['node', 'vouchington', 'gha-artifacts-cleanup', 'sweep'])).toEqual({
      kind: 'error',
      message: 'gha-artifacts-cleanup sweep requires --older-than-hours',
    })
    expect(
      parseCli(['node', 'vouchington', 'gha-artifacts-cleanup', 'sweep', '--older-than-hours']),
    ).toEqual({
      kind: 'error',
      message: '--older-than-hours requires a value',
    })
    expect(
      parseCli([
        'node',
        'vouchington',
        'gha-artifacts-cleanup',
        'sweep',
        '--older-than-hours',
        '   ',
      ]),
    ).toEqual({
      kind: 'error',
      message: '--older-than-hours must be a non-negative number',
    })
    expect(
      parseCli([
        'node',
        'vouchington',
        'gha-artifacts-cleanup',
        'sweep',
        '--older-than-hours',
        '-1',
      ]),
    ).toEqual({
      kind: 'error',
      message: '--older-than-hours must be a non-negative number',
    })
    expect(
      parseCli(['node', 'vouchington', 'gha-artifacts-cleanup', 'run', '--keep-pattern']),
    ).toEqual({
      kind: 'error',
      message: '--keep-pattern requires a value',
    })
    expect(parseCli(['node', 'vouchington', 'gha-artifacts-cleanup', 'run', '--wat'])).toEqual({
      kind: 'error',
      message: 'unknown gha-artifacts-cleanup option: --wat',
    })
    expect(parseCli(['node', 'vouchington', 'gha-artifacts-cleanup', 'run', '--run-id'])).toEqual({
      kind: 'error',
      message: '--run-id requires a value',
    })
    expect(
      parseCli(['node', 'vouchington', 'gha-artifacts-cleanup', 'run', '--delete-pattern']),
    ).toEqual({
      kind: 'error',
      message: '--delete-pattern requires a value',
    })
    expect(
      parseCli(['node', 'vouchington', 'gha-artifacts-cleanup', 'run', '--patterns-file']),
    ).toEqual({
      kind: 'error',
      message: '--patterns-file requires a value',
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
