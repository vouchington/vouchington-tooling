import { existsSync, globSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  codexChildren,
  codexIdentity,
  computeCodex,
  withoutLeadingSessionMetadata,
} from './codex.mts'
import { computeClaude } from './claude.mts'
import { formatTranscriptFacts, formatUnavailable, sessionLabel } from './format.mts'
import {
  emptyFacts,
  emptyTokens,
  hasMalformedInteriorRecord,
  parseLines,
  type CodexSegment,
  type TranscriptFacts,
} from './shared.mts'
export type { TokenTotals, TranscriptFacts } from './shared.mts'
export { codexChildren, codexIdentity } from './codex.mts'
export { formatTranscriptFacts, formatUnavailable } from './format.mts'
export type ResolveOptions = {
  sessionId?: string
  jsonlPath?: string
  projectsDir?: string
  codexSessionsDir?: string
  grokSessionsDir?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
}
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MALFORMED_INTERIOR = 'malformed interior transcript record'
type TranscriptResolution = { path: string; sessionId: string } | { error: string }
function globFrom(root: string, pattern: string): string[] {
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
    ['CODEX_THREAD_ID', 'CLAUDE_CODE_SESSION_ID', 'CURSOR_SESSION_ID', 'GROK_SESSION_ID']
      .map((key) => env[key])
      .find(Boolean)
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
function schema(lines: string[]): 'claude' | 'codex' | undefined {
  const records = parseLines(lines)
  const kinds = new Set(
    records
      .map((record) =>
        record.type === 'user' || record.type === 'assistant'
          ? 'claude'
          : record.type === 'session_meta' ||
              record.type === 'event_msg' ||
              record.type === 'response_item' ||
              record.type === 'compacted'
            ? 'codex'
            : undefined,
      )
      .filter(Boolean),
  )
  return kinds.size === 1 ? ([...kinds][0] as 'claude' | 'codex') : undefined
}
export function computeTranscriptFacts(
  lines: string[],
  subagents: Array<string[] | CodexSegment> = [],
): TranscriptFacts {
  const detected = schema(lines)
  if (!detected) return emptyFacts()
  if (detected === 'claude')
    return computeClaude([
      lines,
      ...subagents.map((value) => (Array.isArray(value) ? value : value.lines)),
    ])
  if (subagents.some(Array.isArray)) throw new TypeError('Codex subagents must be segmented')
  return computeCodex(lines, subagents as CodexSegment[])
}
async function readLines(path: string): Promise<string[] | undefined> {
  return (await readFile(path, 'utf8').catch(() => undefined))?.split('\n')
}
function childPath(threadId: string, sessionsDir: string): string | undefined {
  if (!SESSION_ID.test(threadId)) return undefined
  const paths = globFrom(sessionsDir, `**/rollout-*-${threadId}.jsonl`).sort()
  return paths.length === 1 ? paths[0] : undefined
}
function matchesChildIdentity(lines: string[], threadId: string, agentPath: string): boolean {
  const first = parseLines(lines.filter(Boolean).slice(0, 1))[0]
  if (first?.type !== 'session_meta') return true
  const identity = codexIdentity(lines)
  const threadMatches = identity.threadId?.toLowerCase() === threadId.toLowerCase()
  return threadMatches && identity.agentPath.replace(/\/$/, '') === agentPath
}
async function codexSubagents(
  lines: string[],
  sessionsDir: string,
  ownerPath: string,
  visited = new Set<string>(),
): Promise<CodexSegment[] | undefined> {
  const result: CodexSegment[] = []
  for (const edge of codexChildren(lines, ownerPath)) {
    if (visited.has(edge.threadId)) continue
    visited.add(edge.threadId)
    const path = childPath(edge.threadId, sessionsDir)
    if (!path || !existsSync(path)) return undefined
    const child = await readLines(path)
    if (
      !child ||
      schema(child) !== 'codex' ||
      hasMalformedInteriorRecord(child) ||
      !matchesChildIdentity(child, edge.threadId, edge.agentPath)
    )
      return undefined
    const content = withoutLeadingSessionMetadata(child)
    result.push({ lines: content, baseline: emptyTokens() })
    const nested = await codexSubagents(content, sessionsDir, edge.agentPath, visited)
    if (!nested) return undefined
    result.push(...nested)
  }
  return result
}
export async function runRetrospectiveTranscript(options: ResolveOptions): Promise<string> {
  const resolved = resolveTranscriptFile(options)
  if ('error' in resolved) return formatUnavailable(resolved.error)
  const lines = await readLines(resolved.path)
  if (!lines) return formatUnavailable('could not read transcript')
  const detected = schema(lines)
  if (!detected) return formatUnavailable('unsupported or mixed transcript schema')
  if (hasMalformedInteriorRecord(lines)) return formatUnavailable(MALFORMED_INTERIOR)
  if (detected === 'claude') {
    const directory = join(dirname(resolved.path), basename(resolved.path, '.jsonl'), 'subagents')
    const subagents = await Promise.all(globFrom(directory, '*.jsonl').sort().map(readLines))
    return formatTranscriptFacts(
      resolved.sessionId,
      computeTranscriptFacts(
        lines,
        subagents.filter(
          (value): value is string[] =>
            value !== undefined && schema(value) === 'claude' && !hasMalformedInteriorRecord(value),
        ),
      ),
    )
  }
  const identity = codexIdentity(lines)
  const codexHome = (options.env ?? process.env).CODEX_HOME
  const subagents = await codexSubagents(
    lines,
    options.codexSessionsDir ??
      (options.jsonlPath ? dirname(resolved.path) : undefined) ??
      join(codexHome || join(homedir(), '.codex'), 'sessions'),
    identity.agentPath,
    new Set(
      [identity.threadId ?? resolved.sessionId].filter((threadId) => SESSION_ID.test(threadId)),
    ),
  )
  if (!subagents) return formatUnavailable('could not resolve a referenced Codex child transcript')
  return formatTranscriptFacts(
    resolved.sessionId,
    computeTranscriptFacts(withoutLeadingSessionMetadata(lines), subagents),
  )
}
