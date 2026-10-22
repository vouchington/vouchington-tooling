import { open } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { openTranscriptLines } from '../retrospective-transcript/index.mts'
import { globFrom } from '../retrospective-transcript/resolve-transcript-file.mts'

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

// A top-level session file is the canonical source of a project's cwd: a subagent transcript
// under <session>/subagents/ may carry none. Glob order is filesystem-dependent, so the first
// file that yields a cwd wins; every session in one project directory shares its cwd.
async function resolveProjectCwd(
  projectsDir: string,
  projectDir: string,
): Promise<string | undefined> {
  for (const entry of globFrom(join(projectsDir, projectDir), '*.jsonl')) {
    // oxlint-disable-next-line no-await-in-loop
    const cwd = await readTranscriptCwd(entry)
    if (cwd !== undefined) return cwd
  }
  return undefined
}

/**
 * Resolves a Claude transcript's cwd once per project directory (the path segment directly under
 * `projectsDir`) and memoizes it, so thousands of files cost a handful of reads and a subagent
 * transcript resolves through its project's session files. The directory name is never decoded:
 * the encoding is lossy and would over-match sibling repos. A rejected lookup is evicted so the
 * next call retries.
 */
export function claudeProjectCwdResolver(
  projectsDir: string,
): (path: string) => Promise<string | undefined> {
  const cache = new Map<string, Promise<string | undefined>>()
  return async (path) => {
    const rel = relative(projectsDir, path)
    const projectDir = rel.split(sep)[0]!
    let resolved = cache.get(projectDir)
    if (resolved === undefined) {
      resolved = resolveProjectCwd(projectsDir, projectDir)
      resolved.catch(() => cache.delete(projectDir))
      cache.set(projectDir, resolved)
    }
    return resolved
  }
}
