import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import picomatch from 'picomatch'
import { parseAllDocuments } from 'yaml'

export interface CheckAstGrepIgnoresFreshnessOptions {
  /** The tracked local rule directory, for example `ast-grep-rules`. */
  localRuleDir: string
}

export interface AstGrepStaleIgnore {
  /** The tracked rule file, relative to the repository root. */
  ruleFile: string
  /** The `ignores:` entry that names no tracked file and matches no tracked path. */
  entry: string
}

/** Glob metacharacters ast-grep ignore entries use. A path without them is a literal file. */
const GLOB_METACHARACTER = /[*?{[]/u

/** Returns the string entries of a rule document's `ignores:` (a string or a list). */
export function astGrepIgnoreEntries(document: unknown): string[] {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) return []
  const ignores = (document as { ignores?: unknown }).ignores
  if (typeof ignores === 'string') return [ignores]
  if (!Array.isArray(ignores)) return []
  return ignores.filter((entry): entry is string => typeof entry === 'string')
}

/** ast-grep treats parentheses as literal path characters; picomatch would read them as groups. */
function literalParentheses(glob: string): string {
  return glob.replace(/[()]/gu, '\\$&')
}

/** Returns the ignore entries that name a missing file or match no tracked path. */
export function staleAstGrepIgnores(
  ignores: readonly string[],
  trackedFiles: readonly string[],
): string[] {
  const tracked = new Set(trackedFiles)
  const globState = new Map<string, { matched: boolean; matches: (file: string) => boolean }>()
  for (const entry of ignores) {
    if (!GLOB_METACHARACTER.test(entry) || globState.has(entry)) continue
    globState.set(entry, {
      matched: false,
      matches: picomatch(literalParentheses(entry), { dot: true }),
    })
  }
  for (const file of trackedFiles) {
    for (const glob of globState.values()) {
      if (!glob.matched && glob.matches(file)) glob.matched = true
    }
  }
  return ignores.filter((entry) => {
    const glob = globState.get(entry)
    return glob === undefined ? !tracked.has(entry) : !glob.matched
  })
}

/**
 * Checks every tracked `*.yml` rule under `localRuleDir` for `ignores:` entries that name no tracked
 * file and match no tracked glob. Reads the rule files from `repoRoot`; `trackedFiles` are
 * root-relative tracked paths.
 */
export function checkAstGrepIgnoresFreshness(
  repoRoot: string,
  trackedFiles: readonly string[],
  options: CheckAstGrepIgnoresFreshnessOptions,
): AstGrepStaleIgnore[] {
  const prefix = `${posix.normalize(options.localRuleDir).replace(/\/+$/, '')}/`
  const stale: AstGrepStaleIgnore[] = []
  for (const ruleFile of trackedFiles) {
    if (!ruleFile.startsWith(prefix) || !ruleFile.endsWith('.yml')) continue
    const documents = parseAllDocuments(readFileSync(join(repoRoot, ruleFile), 'utf8'))
    for (const document of documents) {
      const entries = astGrepIgnoreEntries(document.toJS())
      for (const entry of staleAstGrepIgnores(entries, trackedFiles)) {
        stale.push({ ruleFile, entry })
      }
    }
  }
  return stale
}
