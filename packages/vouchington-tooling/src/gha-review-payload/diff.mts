import type { ReviewSide } from './payload.mts'

export type LineKind = 'add' | 'del' | 'context'

export type ReviewFile = {
  filename: string
  previous_filename?: string
  patch?: string
  status?: string
}

export type CommentableIndex = {
  resolvePath(path: string): string | undefined
  hasPatch(path: string): boolean
  has(path: string, side: ReviewSide, line: number): boolean
  kind(path: string, side: ReviewSide, line: number): LineKind | undefined
  candidates(path: string, side: ReviewSide): Array<{ line: number; kind: LineKind }>
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u

export type CommentableLine = {
  path: string
  side: ReviewSide
  line: number
  kind: LineKind
}

/** Indexes added, deleted, and context lines from a unified diff hunk. */
export function parsePatchCommentable(path: string, patch: string): CommentableLine[] {
  const lines: CommentableLine[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  for (const raw of patch.split('\n')) {
    const hunk = HUNK_RE.exec(raw)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      inHunk = true
      continue
    }
    if (!inHunk || raw.length === 0 || raw.startsWith('\\')) continue
    const marker = raw[0]
    if (marker === '-') {
      lines.push({ path, side: 'LEFT', line: oldLine, kind: 'del' })
      oldLine += 1
    } else if (marker === '+') {
      lines.push({ path, side: 'RIGHT', line: newLine, kind: 'add' })
      newLine += 1
    } else {
      lines.push({ path, side: 'LEFT', line: oldLine, kind: 'context' })
      lines.push({ path, side: 'RIGHT', line: newLine, kind: 'context' })
      oldLine += 1
      newLine += 1
    }
  }
  return lines
}

function asReviewFiles(parsed: unknown): ReviewFile[] {
  const items = Array.isArray(parsed) ? parsed : [parsed]
  return items.flatMap((item) => {
    if (item === null || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.filename !== 'string' || record.filename.length === 0) return []
    const file: ReviewFile = { filename: record.filename }
    if (typeof record.previous_filename === 'string')
      file.previous_filename = record.previous_filename
    if (typeof record.patch === 'string') file.patch = record.patch
    if (typeof record.status === 'string') file.status = record.status
    return [file]
  })
}

/** Parses one or concatenated paginated JSON responses, dropping malformed file entries. */
export function parseReviewFilesJson(text: string): ReviewFile[] {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  try {
    return asReviewFiles(JSON.parse(trimmed) as unknown)
  } catch {
    try {
      const wrapped = `[${trimmed
        .replace(/^\[/u, '')
        .replace(/\]$/u, '')
        .replace(/\]\s*\[/gu, ',')}]`
      return asReviewFiles(JSON.parse(wrapped) as unknown)
    } catch {
      return []
    }
  }
}

function entryKey(path: string, side: ReviewSide, line: number): string {
  return `${path}\0${side}\0${line}`
}

/** Creates a fast path/side/line lookup and retains rename aliases. */
export function indexReviewFiles(files: readonly ReviewFile[]): CommentableIndex {
  const byKey = new Map<string, LineKind>()
  const aliases = new Map<string, string>()
  const patched = new Set<string>()
  const known = new Set<string>()
  for (const file of files) {
    known.add(file.filename)
    if (file.previous_filename) aliases.set(file.previous_filename, file.filename)
    if (file.patch === undefined || file.patch.length === 0) continue
    patched.add(file.filename)
    for (const entry of parsePatchCommentable(file.filename, file.patch)) {
      byKey.set(entryKey(entry.path, entry.side, entry.line), entry.kind)
    }
  }
  return {
    resolvePath(path) {
      if (known.has(path)) return path
      return aliases.get(path)
    },
    hasPatch(path) {
      return patched.has(path)
    },
    has(path, side, line) {
      return byKey.has(entryKey(path, side, line))
    },
    kind(path, side, line) {
      return byKey.get(entryKey(path, side, line))
    },
    candidates(path, side) {
      const prefix = `${path}\0${side}\0`
      const found: Array<{ line: number; kind: LineKind }> = []
      for (const [key, kind] of byKey) {
        if (!key.startsWith(prefix)) continue
        found.push({ line: Number(key.slice(prefix.length)), kind })
      }
      return found
    },
  }
}
