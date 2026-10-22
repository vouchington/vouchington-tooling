import { open } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { openTranscriptLines } from '../retrospective-transcript/index.mts'

const PREFIX_BYTES = 64 * 1024

async function readPrefix(
  path: string,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  await using handle = await open(path, 'r')
  const buffer = Buffer.alloc(maxBytes)
  const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
  return { text: buffer.toString('utf8', 0, bytesRead), truncated: bytesRead === maxBytes }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function cwdFromRecord(record: unknown): string | undefined {
  if (typeof record !== 'object' || record === null) return undefined
  const top = nonEmptyString((record as { cwd?: unknown }).cwd)
  if (top !== undefined) return top
  return nonEmptyString((record as { payload?: { cwd?: unknown } }).payload?.cwd)
}

function cwdFromLine(line: string): string | undefined {
  if (line.length === 0) return undefined
  try {
    return cwdFromRecord(JSON.parse(line))
  } catch {
    // A malformed or partial line is skipped: the cwd is read best-effort.
    return undefined
  }
}

// A prefix read almost always cuts its final line mid-object, so that fragment is dropped.
function cwdFromText(text: string, dropLastLine: boolean): string | undefined {
  const lines = text.split('\n')
  for (const line of dropLastLine ? lines.slice(0, -1) : lines) {
    const cwd = cwdFromLine(line)
    if (cwd !== undefined) return cwd
  }
  return undefined
}

/**
 * The first `cwd` in a transcript, top-level (Claude records) or at `payload.cwd` (Codex
 * `session_meta`). It reads a 64 KB prefix and streams the whole file only when that prefix is
 * truncated and yielded nothing. First-cwd-wins: a session that later `cd`s into another repo is
 * bucketed by its earliest cwd.
 */
export async function readTranscriptCwd(path: string): Promise<string | undefined> {
  const prefix = await readPrefix(path, PREFIX_BYTES)
  const fromPrefix = cwdFromText(prefix.text, prefix.truncated)
  if (fromPrefix !== undefined || !prefix.truncated) return fromPrefix
  const opened = await openTranscriptLines(path)
  if ('error' in opened) throw new Error(opened.error)
  for await (const line of opened.lines) {
    const cwd = cwdFromLine(line)
    if (cwd !== undefined) return cwd
  }
  return undefined
}

// A Claude project directory name is a lossy encoding of the cwd, so distinct checkouts can share
// one. The cwd is therefore read per session: a top-level session file carries its own, and a
// subagent transcript under <session>/subagents/ resolves through its owning session file.
function owningSessionFile(projectsDir: string, path: string): string {
  const [projectDir, session, folder] = relative(projectsDir, path).split(sep)
  return folder === 'subagents' ? join(projectsDir, projectDir!, `${session}.jsonl`) : path
}

/**
 * Resolves a Claude transcript's cwd from its own session file (or its subagent's owning session)
 * and memoizes it per session file. A session whose owner is missing or unreadable rejects, which
 * discovery counts as an unknown cwd rather than guessing from a sibling session. A rejected
 * lookup is evicted so the next call retries.
 */
export function claudeSessionCwdResolver(
  projectsDir: string,
): (path: string) => Promise<string | undefined> {
  const cache = new Map<string, Promise<string | undefined>>()
  return async (path) => {
    const owner = owningSessionFile(projectsDir, path)
    let resolved = cache.get(owner)
    if (resolved === undefined) {
      resolved = readTranscriptCwd(owner)
      resolved.catch(() => cache.delete(owner))
      cache.set(owner, resolved)
    }
    return resolved
  }
}
