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
import {
  emptyFacts,
  emptyTokens,
  parseLines,
  type CodexSegment,
  type TranscriptFacts,
} from './shared.mts'
export type { TokenTotals, TranscriptFacts } from './shared.mts'
export { codexChildren, codexIdentity } from './codex.mts'
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
const LABEL_CHARACTER = /[^A-Za-z0-9._-]+/g
function sessionLabel(value: string): string {
  return value.replace(/\s+/g, '_').replace(LABEL_CHARACTER, '_').slice(0, 128) || 'transcript'
}

export function resolveTranscriptFile(
  options: ResolveOptions,
): { path: string; sessionId: string } | { error: string } {
  if (options.sessionId && !SESSION_ID.test(options.sessionId))
    return { error: 'invalid session id format' }
  if (options.jsonlPath)
    return {
      path: options.jsonlPath,
      sessionId: options.sessionId ?? sessionLabel(basename(options.jsonlPath, '.jsonl')),
    }
  const sessionId =
    options.sessionId ??
    (options.env ?? process.env).CODEX_THREAD_ID ??
    (options.env ?? process.env).CLAUDE_CODE_SESSION_ID ??
    (options.env ?? process.env).CURSOR_SESSION_ID ??
    (options.env ?? process.env).GROK_SESSION_ID
  if (!sessionId)
    return {
      error:
        'no session id (pass --session-id or set CODEX_THREAD_ID, CLAUDE_CODE_SESSION_ID, CURSOR_SESSION_ID, or GROK_SESSION_ID)',
    }
  if (!SESSION_ID.test(sessionId)) return { error: 'invalid session id format' }
  const codex = options.codexSessionsDir ?? join(homedir(), '.codex', 'sessions')
  const claude = options.projectsDir ?? join(homedir(), '.claude', 'projects')
  const grokHome = (options.env ?? process.env).GROK_HOME || join(homedir(), '.grok')
  const grok = options.grokSessionsDir ?? join(grokHome, 'sessions')
  const encodedCwd = encodeURIComponent(options.cwd ?? process.cwd())
  const grokExact = join(grok, encodedCwd, sessionId, 'updates.jsonl')
  const grokPaths = existsSync(grokExact)
    ? [grokExact]
    : globSync(join(grok, '*', sessionId, 'updates.jsonl').replace(/\\/g, '/'))
  const codexPaths = globSync(join(codex, '**', `rollout-*-${sessionId}.jsonl`).replace(/\\/g, '/'))
  const claudePaths = globSync(join(claude, '*', `${sessionId}.jsonl`).replace(/\\/g, '/'))
  const paths = [...grokPaths, ...codexPaths, ...claudePaths].sort()
  if (paths.length > 1) return { error: `multiple transcripts found for session ${sessionId}` }
  return paths[0]
    ? { path: paths[0], sessionId }
    : { error: `no transcript found for session ${sessionId}` }
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
  try {
    return (await readFile(path, 'utf8')).split('\n')
  } catch {
    return undefined
  }
}

function childPath(threadId: string, sessionsDir: string): string | undefined {
  if (!SESSION_ID.test(threadId)) return undefined
  const paths = globSync(
    join(sessionsDir, '**', `rollout-*-${threadId}.jsonl`).replace(/\\/g, '/'),
  ).sort()
  return paths.length === 1 ? paths[0] : undefined
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
    if (!child || schema(child) !== 'codex') return undefined
    const content = withoutLeadingSessionMetadata(child)
    result.push({ lines: content, baseline: emptyTokens() })
    const nested = await codexSubagents(content, sessionsDir, edge.agentPath, visited)
    if (!nested) return undefined
    result.push(...nested)
  }
  return result
}

export function formatTranscriptFacts(sessionId: string, facts: TranscriptFacts): string {
  return [
    '=== Transcript Facts ===',
    `Session: ${sessionLabel(sessionId)}`,
    `User prompts: ${facts.userPrompts}`,
    `Assistant responses: ${facts.assistantResponses}`,
    `Tool calls: ${facts.toolCalls} (failed: ${facts.failedToolCalls})`,
    `no-mistakes invocations: ${facts.noMistakesInvocations}`,
    `advisor calls: ${facts.advisorCalls}`,
    `Push commands attempted: ${facts.pushCommandAttempts}`,
    `Compactions: ${facts.compactions}`,
    `Tokens: input=${facts.tokens.input} output=${facts.tokens.output} cache_read=${facts.tokens.cacheRead} cache_creation=${facts.tokens.cacheCreation}`,
    `Subagent tool calls: ${facts.subagentToolCalls}`,
    `Subagent tokens: input=${facts.subagentTokens.input} output=${facts.subagentTokens.output} cache_read=${facts.subagentTokens.cacheRead} cache_creation=${facts.subagentTokens.cacheCreation}`,
    '',
  ].join('\n')
}

export const formatUnavailable = (reason: string): string =>
  `=== Transcript Facts ===\nStatus: unavailable (${reason.replace(/\s+/g, ' ').slice(0, 240)})\n`

export async function runRetrospectiveTranscript(options: ResolveOptions): Promise<string> {
  const resolved = resolveTranscriptFile(options)
  if ('error' in resolved) return formatUnavailable(resolved.error)
  const lines = await readLines(resolved.path)
  if (!lines) return formatUnavailable('could not read transcript')
  const detected = schema(lines)
  if (!detected) return formatUnavailable('unsupported or mixed transcript schema')
  if (detected === 'claude') {
    const directory = join(dirname(resolved.path), basename(resolved.path, '.jsonl'), 'subagents')
    const subagents = await Promise.all(globSync(join(directory, '*.jsonl')).sort().map(readLines))
    return formatTranscriptFacts(
      resolved.sessionId,
      computeTranscriptFacts(
        lines,
        subagents.filter((value): value is string[] => value !== undefined),
      ),
    )
  }
  const identity = codexIdentity(lines)
  const subagents = await codexSubagents(
    lines,
    options.codexSessionsDir ?? join(homedir(), '.codex', 'sessions'),
    identity.agentPath,
    new Set(identity.threadId ? [identity.threadId] : []),
  )
  if (!subagents) return formatUnavailable('could not resolve a referenced Codex child transcript')
  return formatTranscriptFacts(
    resolved.sessionId,
    computeTranscriptFacts(withoutLeadingSessionMetadata(lines), subagents),
  )
}
