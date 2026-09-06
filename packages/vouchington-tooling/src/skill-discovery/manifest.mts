import { lstat, readFile, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, join } from 'node:path'

export type SkillManifestEntry = {
  name: string
  plugin: string
  pluginVersion: string
  path: string
  prerequisites?: string[]
}

export type SkillManifest = { version: 1; skills: SkillManifestEntry[] }

export async function readSkillManifest(sourceRoot: string): Promise<SkillManifest> {
  const root = await realpath(resolve(sourceRoot))
  const parsed: unknown = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
  if (!isManifest(parsed)) throw new Error('Invalid skills manifest')
  await validateManifestEntries(root, parsed.skills)
  return parsed
}

export function assertContained(root: string, child: string): string {
  if (isAbsolute(child)) throw new Error(`Skill path escapes root: ${child}`)
  const path = resolve(root, child)
  if (!isContained(root, path)) throw new Error(`Skill path escapes root: ${child}`)
  return path
}

export function isSafeSkillName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

export function isContained(root: string, path: string): boolean {
  const pathRelative = relative(root, path)
  return !pathRelative.startsWith('..') && !isAbsolute(pathRelative)
}

async function validateManifestEntries(root: string, entries: SkillManifestEntry[]): Promise<void> {
  const names = new Set<string>()
  const lexicalPaths = new Set<string>()
  const canonicalPaths = new Set<string>()
  for (const entry of entries) {
    if (!isSafeSkillName(entry.name)) throw new Error(`Invalid skill name: ${entry.name}`)
    if (names.has(entry.name)) throw new Error(`Duplicate skill name: ${entry.name}`)
    names.add(entry.name)
    const prerequisites = entry.prerequisites ?? []
    if (new Set(prerequisites).size !== prerequisites.length)
      throw new Error(`Duplicate skill prerequisite: ${entry.name}`)
    for (const prerequisite of prerequisites) {
      if (!isSafeSkillName(prerequisite))
        throw new Error(`Invalid skill prerequisite: ${prerequisite}`)
    }
    if (basename(entry.path) !== 'SKILL.md') throw new Error(`Invalid skill source: ${entry.path}`)
    const path = assertContained(root, entry.path)
    if (lexicalPaths.has(path)) throw new Error(`Duplicate skill path: ${entry.path}`)
    lexicalPaths.add(path)
    let canonicalPath: string
    try {
      canonicalPath = await realpath(path)
    } catch {
      throw new Error(`Invalid skill source: ${entry.path}`)
    }
    if (!isContained(root, canonicalPath))
      throw new Error(`Skill source escapes root: ${entry.path}`)
    if (!(await lstat(canonicalPath)).isFile())
      throw new Error(`Invalid skill source: ${entry.path}`)
    if (canonicalPaths.has(canonicalPath)) throw new Error(`Duplicate skill path: ${entry.path}`)
    canonicalPaths.add(canonicalPath)
  }
  for (const entry of entries) {
    for (const prerequisite of entry.prerequisites ?? []) {
      if (!names.has(prerequisite)) throw new Error(`Missing prerequisite skill: ${prerequisite}`)
    }
  }
}

function isManifest(value: unknown): value is SkillManifest {
  if (value === null || typeof value !== 'object') return false
  // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- establish the candidate schema type after the runtime object check
  const manifest = value as Partial<SkillManifest>
  return manifest.version === 1 && Array.isArray(manifest.skills) && manifest.skills.every(isEntry)
}

function isEntry(value: unknown): value is SkillManifestEntry {
  if (value === null || typeof value !== 'object') return false
  // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- establish the candidate schema type after the runtime object check
  const entry = value as Partial<SkillManifestEntry>
  return (
    [entry.name, entry.plugin, entry.pluginVersion, entry.path].every(
      (field) => typeof field === 'string' && field.length > 0,
    ) &&
    (entry.prerequisites === undefined ||
      (Array.isArray(entry.prerequisites) &&
        entry.prerequisites.every((name) => typeof name === 'string')))
  )
}
