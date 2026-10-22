import { readFile } from 'node:fs/promises'
import { parse as load } from 'yaml'
import picomatch from 'picomatch'

type GlobEntry = string | { 'any-glob-to-any-file': string | string[] }
type LabelerRule = { 'changed-files'?: GlobEntry[] }
type Labeler = Record<string, LabelerRule[]>

/** The conventional labeler config location, relative to the repository root. */
export const DEFAULT_LABELER_PATH = '.github/labeler.yml'

async function readLabeler(labelerPath: string): Promise<Labeler> {
  try {
    const parsed: unknown = load(await readFile(labelerPath, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as Labeler) : {}
  } catch {
    return {}
  }
}

function entryGlobs(entry: GlobEntry): string[] {
  if (typeof entry === 'string') return [entry]
  const globs = entry['any-glob-to-any-file']
  return Array.isArray(globs) ? globs : [globs]
}

/**
 * Maps changed paths to the labels an `actions/labeler` v5 config (`changed-files` with plain or
 * `any-glob-to-any-file` entries) would apply. A missing or unparseable config yields no labels.
 * Labels are returned once each, in config order.
 */
export async function labelsFromPaths(paths: string[], labelerPath: string): Promise<string[]> {
  const labeler = await readLabeler(labelerPath)
  const matched: string[] = []
  for (const [label, rules] of Object.entries(labeler)) {
    if (!Array.isArray(rules)) continue
    const hit = rules.some((rule) =>
      (rule['changed-files'] ?? []).some((entry) => {
        const isMatch = picomatch(entryGlobs(entry))
        return paths.some((path) => isMatch(path))
      }),
    )
    if (hit) matched.push(label)
  }
  return matched
}
