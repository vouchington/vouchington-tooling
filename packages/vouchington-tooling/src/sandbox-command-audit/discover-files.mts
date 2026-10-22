import { statSync } from 'node:fs'
import { globFrom } from '../retrospective-transcript/resolve-transcript-file.mts'
import { isWithinRepoRoots } from './repo-scope.mts'
import { claudeProjectCwdResolver, readTranscriptCwd } from './transcript-cwd.mts'
import type { SkipCounts } from './types.mts'

export type DiscoverOptions = {
  /** Root holding Claude project transcripts (`<root>/<project>/<session>.jsonl`). */
  projectsDir: string
  /** Root holding Codex rollouts (`<root>/**\/rollout-*-<session>.jsonl`). */
  codexSessionsDir: string
  /** Most-recent files kept per root, applied after repo scoping. */
  maxFilesPerRoot: number
  /** Drops files last modified before `now - sinceDays`, before the cap. */
  sinceDays?: number
  /** Clock for `sinceDays`; injected so tests use a fixed one. */
  now?: number
  /**
   * Narrows discovery to one session's transcripts. An explicit session is already an exact
   * target, so it bypasses repo scoping: it must never be lost to an unresolved cwd.
   */
  sessionId?: string
  /** Roots to scope discovery to. Empty means unscoped (purely mtime-ordered). */
  repoRoots: string[]
}

export type DiscoveredFiles = {
  claudeFiles: string[]
  codexFiles: string[]
  skippedOtherRepo: SkipCounts
  skippedUnknownCwd: SkipCounts
}

type StatEntry = { path: string; mtimeMs: number }
type ResolveCwd = (path: string) => Promise<string | undefined>
type SelectResult = { files: string[]; skippedOtherRepo: number; skippedUnknownCwd: number }

const DAY_MS = 24 * 60 * 60 * 1000

// Stats every candidate, drops anything outside the window, and sorts newest first. The cap is
// applied later, after repo scoping: capping first would fill a small limit with other
// repositories' files.
function statAndSort(paths: string[], cutoffMs: number | undefined): StatEntry[] {
  const entries: StatEntry[] = []
  for (const path of paths) {
    try {
      entries.push({ path, mtimeMs: statSync(path).mtimeMs })
    } catch {
      // A file removed between glob and stat, or unreadable, is skipped: discovery is best-effort.
    }
  }
  const inWindow = entries.filter((entry) => cutoffMs === undefined || entry.mtimeMs >= cutoffMs)
  return inWindow.toSorted((a, b) => b.mtimeMs - a.mtimeMs)
}

/**
 * Walks the newest-first list resolving each file's cwd and keeping in-repo files until `limit`.
 * The skip counts are lower bounds, because the walk stops at `limit`. A file whose cwd cannot be
 * resolved is excluded (fail closed) but always counted.
 */
export async function selectInRepo(
  entries: StatEntry[],
  limit: number,
  repoRoots: string[],
  resolveCwd: ResolveCwd,
): Promise<SelectResult> {
  const files: string[] = []
  let skippedOtherRepo = 0
  let skippedUnknownCwd = 0
  for (const entry of entries) {
    if (files.length >= limit) break
    const cwd = await resolveCwd(entry.path).catch(() => undefined)
    if (cwd === undefined) {
      skippedUnknownCwd++
    } else if (await isWithinRepoRoots(cwd, repoRoots)) {
      files.push(entry.path)
    } else {
      skippedOtherRepo++
    }
  }
  return { files, skippedOtherRepo, skippedUnknownCwd }
}

async function discoverForRoot(
  paths: string[],
  options: DiscoverOptions,
  resolveCwd: ResolveCwd,
): Promise<SelectResult> {
  const cutoffMs =
    options.sinceDays === undefined
      ? undefined
      : (options.now ?? Date.now()) - options.sinceDays * DAY_MS
  const sorted = statAndSort(paths, cutoffMs)
  if (options.sessionId !== undefined || options.repoRoots.length === 0) {
    const files = sorted.slice(0, options.maxFilesPerRoot).map((entry) => entry.path)
    return { files, skippedOtherRepo: 0, skippedUnknownCwd: 0 }
  }
  return selectInRepo(sorted, options.maxFilesPerRoot, options.repoRoots, resolveCwd)
}

// Top-level session files and subagent transcripts share one JSONL schema, so one recursive glob
// finds both. A session id needs two precise patterns: `**/<id>*.jsonl` would also match
// unrelated sessions that share a prefix.
function claudePaths(options: DiscoverOptions): string[] {
  const { projectsDir, sessionId } = options
  if (sessionId === undefined) return globFrom(projectsDir, '**/*.jsonl')
  return [
    ...globFrom(projectsDir, `**/${sessionId}.jsonl`),
    ...globFrom(projectsDir, `**/${sessionId}/subagents/*.jsonl`),
  ]
}

function codexPaths(options: DiscoverOptions): string[] {
  const { codexSessionsDir, sessionId } = options
  return globFrom(
    codexSessionsDir,
    sessionId === undefined ? '**/*.jsonl' : `**/rollout-*-${sessionId}.jsonl`,
  )
}

export async function discoverTranscriptFiles(options: DiscoverOptions): Promise<DiscoveredFiles> {
  const [claude, codex] = await Promise.all([
    discoverForRoot(claudePaths(options), options, claudeProjectCwdResolver(options.projectsDir)),
    discoverForRoot(codexPaths(options), options, readTranscriptCwd),
  ])
  return {
    claudeFiles: claude.files,
    codexFiles: codex.files,
    skippedOtherRepo: { claude: claude.skippedOtherRepo, codex: codex.skippedOtherRepo },
    skippedUnknownCwd: { claude: claude.skippedUnknownCwd, codex: codex.skippedUnknownCwd },
  }
}
