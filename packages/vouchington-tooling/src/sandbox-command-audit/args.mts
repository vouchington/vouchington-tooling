import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { SESSION_ID } from '../retrospective-transcript/resolve-transcript-file.mts'

export type AuditArgs = {
  rules: string
  projectsDir: string
  codexSessionsDir: string
  settingsPath?: string
  maxFilesPerRoot: number
  sinceDays?: number
  sessionId?: string
  json: boolean
  raw: boolean
  /** Undefined resolves the roots from git. */
  repoRoots?: string[]
  worktreeGlobs: string[]
}

const DEFAULT_LIMIT = 50

function positiveInteger(raw: string, flag: string): number {
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${flag} requires a positive integer`)
  return parsed
}

function value(raw: string, flag: string): string {
  if (raw.length === 0 || raw.startsWith('-')) throw new Error(`${flag} requires a value`)
  return raw
}

/**
 * Parses the `sandbox-command-audit` flags. Transcript roots default to the harnesses' own
 * (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`, else the home directory), matching transcript resolution.
 * Throws an Error whose message names the first problem.
 */
export function parseAuditArgs(argv: readonly string[], env: NodeJS.ProcessEnv): AuditArgs {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      rules: { type: 'string' },
      json: { type: 'boolean' },
      raw: { type: 'boolean' },
      limit: { type: 'string' },
      since: { type: 'string' },
      'session-id': { type: 'string' },
      'projects-dir': { type: 'string' },
      'codex-sessions-dir': { type: 'string' },
      'settings-path': { type: 'string' },
      'repo-root': { type: 'string', multiple: true },
      'worktree-glob': { type: 'string', multiple: true },
    },
  })
  if (values.rules === undefined) throw new Error('--rules <module> is required')
  const home = homedir()
  const sessionId = values['session-id']
  if (sessionId !== undefined && !SESSION_ID.test(sessionId)) {
    throw new Error(`--session-id has an invalid format: ${sessionId}`)
  }
  const many = (flag: 'repo-root' | 'worktree-glob'): string[] | undefined =>
    values[flag]?.map((entry) => value(entry, `--${flag}`))
  const since = values.since
  return {
    rules: value(values.rules, '--rules'),
    projectsDir: value(
      values['projects-dir'] ?? join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'projects'),
      '--projects-dir',
    ),
    codexSessionsDir: value(
      values['codex-sessions-dir'] ?? join(env.CODEX_HOME || join(home, '.codex'), 'sessions'),
      '--codex-sessions-dir',
    ),
    maxFilesPerRoot:
      values.limit === undefined ? DEFAULT_LIMIT : positiveInteger(values.limit, '--limit'),
    json: values.json === true,
    raw: values.raw === true,
    worktreeGlobs: many('worktree-glob') ?? [],
    ...(values['settings-path'] === undefined
      ? {}
      : { settingsPath: value(values['settings-path'], '--settings-path') }),
    ...(since === undefined ? {} : { sinceDays: positiveInteger(since, '--since') }),
    ...(sessionId === undefined ? {} : { sessionId: sessionId.toLowerCase() }),
    ...(many('repo-root') === undefined ? {} : { repoRoots: many('repo-root')! }),
  }
}
