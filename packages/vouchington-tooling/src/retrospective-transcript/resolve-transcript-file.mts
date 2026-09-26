import { existsSync, globSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import {
  inspectHarnessEnvironment,
  selectHarnessSession,
} from '../agent-harness-identity/index.mts'
import { sessionLabel } from './format.mts'

export type ResolveOptions = {
  sessionId?: string
  jsonlPath?: string
  projectsDir?: string
  codexSessionsDir?: string
  grokSessionsDir?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type TranscriptResolution = { path: string; sessionId: string } | { error: string }

export function globFrom(root: string, pattern: string): string[] {
  return globSync(pattern, { cwd: root }).map((path) => join(root, path))
}

export function resolveTranscriptFile(options: ResolveOptions): TranscriptResolution {
  if (options.sessionId && !SESSION_ID.test(options.sessionId))
    return { error: 'invalid session id format' }
  if (options.jsonlPath) {
    const filename = basename(options.jsonlPath, '.jsonl')
    const fileSessionId = filename.slice(-36)
    return {
      path: options.jsonlPath,
      sessionId:
        options.sessionId?.toLowerCase() ??
        (SESSION_ID.test(fileSessionId) ? fileSessionId.toLowerCase() : sessionLabel(filename)),
    }
  }
  const env = options.env ?? process.env
  const sessionId =
    options.sessionId ??
    selectHarnessSession(inspectHarnessEnvironment(env), ['codex', 'claude', 'cursor', 'grok'])
      ?.sessionId
  if (!sessionId)
    return {
      error:
        'no session id (pass --session-id or set CODEX_THREAD_ID, CLAUDE_CODE_SESSION_ID, CURSOR_SESSION_ID, or GROK_SESSION_ID)',
    }
  if (!SESSION_ID.test(sessionId)) return { error: 'invalid session id format' }
  const normalizedSessionId = sessionId.toLowerCase()
  const codex =
    options.codexSessionsDir ?? join(env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
  const claude =
    options.projectsDir ?? join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
  const grokHome = env.GROK_HOME || join(homedir(), '.grok')
  const grok = options.grokSessionsDir ?? join(grokHome, 'sessions')
  const encodedCwd = encodeURIComponent(options.cwd ?? process.cwd())
  const grokExact = join(grok, encodedCwd, normalizedSessionId, 'updates.jsonl')
  const grokPaths = existsSync(grokExact)
    ? [grokExact]
    : globFrom(grok, `*/${normalizedSessionId}/updates.jsonl`)
  const codexPaths = globFrom(codex, `**/rollout-*-${normalizedSessionId}.jsonl`)
  const claudePaths = globFrom(claude, `*/${normalizedSessionId}.jsonl`)
  const paths = [...grokPaths, ...codexPaths, ...claudePaths].sort()
  if (paths.length > 1)
    return { error: `multiple transcripts found for session ${normalizedSessionId}` }
  return paths[0]
    ? { path: paths[0], sessionId: normalizedSessionId }
    : { error: `no transcript found for session ${normalizedSessionId}` }
}
