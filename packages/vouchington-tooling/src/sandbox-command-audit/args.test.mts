import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAuditArgs } from './args.mts'

const ID = 'ABCDEF01-2222-3333-4444-555555555555'

describe('parseAuditArgs', () => {
  it('defaults transcript roots to the harness homes and the scan to 50 files', () => {
    expect(parseAuditArgs(['--rules', 'r.mjs'], {})).toEqual({
      rules: 'r.mjs',
      projectsDir: join(homedir(), '.claude', 'projects'),
      codexSessionsDir: join(homedir(), '.codex', 'sessions'),
      maxFilesPerRoot: 50,
      json: false,
      raw: false,
      worktreeGlobs: [],
    })
  })

  it('honors CLAUDE_CONFIG_DIR and CODEX_HOME', () => {
    const args = parseAuditArgs(['--rules', 'r'], { CLAUDE_CONFIG_DIR: '/c', CODEX_HOME: '/x' })
    expect(args).toMatchObject({ projectsDir: '/c/projects', codexSessionsDir: '/x/sessions' })
  })

  it('reads every flag', () => {
    const args = parseAuditArgs(
      [
        '--rules',
        'r',
        '--json',
        '--raw',
        '--limit',
        '7',
        '--since',
        '3',
        '--session-id',
        ID,
        '--projects-dir',
        '/p',
        '--codex-sessions-dir',
        '/s',
        '--settings-path',
        'cfg.json',
        '--repo-root',
        '/a',
        '--repo-root',
        '/b',
        '--worktree-glob',
        '../wt/*',
      ],
      {},
    )
    expect(args).toEqual({
      rules: 'r',
      json: true,
      raw: true,
      maxFilesPerRoot: 7,
      sinceDays: 3,
      sessionId: ID.toLowerCase(),
      projectsDir: '/p',
      codexSessionsDir: '/s',
      settingsPath: 'cfg.json',
      repoRoots: ['/a', '/b'],
      worktreeGlobs: ['../wt/*'],
    })
  })

  it.each([
    [[], '--rules <module> is required'],
    [['--rules=-x'], '--rules requires a value'],
    [['--rules', 'r', '--limit', '0'], '--limit requires a positive integer'],
    [['--rules', 'r', '--limit', 'abc'], '--limit requires a positive integer'],
    [['--rules', 'r', '--since=-1'], '--since requires a positive integer'],
    [['--rules', 'r', '--session-id', 'nope'], '--session-id has an invalid format: nope'],
    [['--rules', 'r', '--settings-path=--raw'], '--settings-path requires a value'],
    [['--rules', 'r', '--projects-dir', ''], '--projects-dir requires a value'],
    [['--rules', 'r', '--codex-sessions-dir=-x'], '--codex-sessions-dir requires a value'],
    [['--rules', 'r', '--repo-root', ''], '--repo-root requires a value'],
    [['--rules', 'r', '--worktree-glob=-g'], '--worktree-glob requires a value'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseAuditArgs(argv, {})).toThrow(message)
  })

  it('rejects an unknown flag', () => {
    expect(() => parseAuditArgs(['--rules', 'r', '--bogus'], {})).toThrow()
  })
})
