import { readFile } from 'node:fs/promises'
import { parse as load } from 'yaml'
import picomatch from 'picomatch'

type GlobEntry = string | { 'any-glob-to-any-file': string | string[] }
type LabelerRule = { 'changed-files'?: GlobEntry[] }
type Labeler = Record<string, LabelerRule[]>

/** The conventional labeler config location, relative to the repository root. */
export const DEFAULT_LABELER_PATH = '.github/labeler.yml'

async function readLabeler(labelerPath: string): Promise<Labeler> {
  let raw: string
  try {
    raw = await readFile(labelerPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  let parsed: unknown
  try {
    parsed = load(raw)
  } catch (error) {
    throw new Error(`invalid labeler config ${labelerPath}: ${(error as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`invalid labeler config ${labelerPath}: top level must be a mapping`)
  }
  return parsed as Labeler
}

function entryGlobs(entry: GlobEntry): string[] {
  if (typeof entry === 'string') return [entry]
  const globs = entry['any-glob-to-any-file']
  return Array.isArray(globs) ? globs : [globs]
}

/**
 * Maps changed paths to the labels an `actions/labeler` v5 config (`changed-files` with plain or
 * `any-glob-to-any-file` entries) would apply, matching dotfiles like the real labeler. A missing
 * config yields no labels; an unparseable or non-mapping config throws with its path.
 * Labels are returned once each, in config order.
 */
export async function labelsFromPaths(paths: string[], labelerPath: string): Promise<string[]> {
  const labeler = await readLabeler(labelerPath)
  const matched: string[] = []
  for (const [label, rules] of Object.entries(labeler)) {
    if (!Array.isArray(rules)) continue
    const hit = rules.some((rule) =>
      (rule['changed-files'] ?? []).some((entry) => {
        const isMatch = picomatch(entryGlobs(entry), { dot: true })
        return paths.some((path) => isMatch(path))
      }),
    )
    if (hit) matched.push(label)
  }
  return matched
}
