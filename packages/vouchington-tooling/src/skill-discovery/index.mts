import { lstat, realpath } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  linkDirectoryEntry,
  resolveTargetDirectory,
  type TargetDirectory,
} from './target-directory.mts'
import {
  assertContained,
  isContained,
  isSafeSkillName,
  readSkillManifest,
  type SkillManifest,
  type SkillManifestEntry,
} from './manifest.mts'

export { readSkillManifest, type SkillManifest, type SkillManifestEntry } from './manifest.mts'

export type LinkSkillOptions = {
  name: string
  sourceRoot: string
  targetRoot: string
}

export type LinkSkillResult = { created: boolean; path: string; source: string }

export async function linkSkill(options: LinkSkillOptions): Promise<LinkSkillResult> {
  if (!isSafeSkillName(options.name)) throw new Error(`Invalid skill name: ${options.name}`)
  const sourceRoot = resolve(options.sourceRoot)
  const canonicalSourceRoot = await realpath(sourceRoot)
  const manifest = await readSkillManifest(sourceRoot)
  const entry = manifest.skills.find((candidate) => candidate.name === options.name)
  if (entry === undefined) throw new Error(`Unknown skill: ${options.name}`)
  const targetRoot = await resolveTargetDirectory(options.targetRoot)
  const linked = new Set<string>()
  const linking = new Set<string>()
  return linkManifestSkill(
    sourceRoot,
    canonicalSourceRoot,
    targetRoot,
    manifest,
    entry,
    linked,
    linking,
  )
}

async function linkManifestSkill(
  sourceRoot: string,
  canonicalSourceRoot: string,
  targetRoot: TargetDirectory,
  manifest: SkillManifest,
  entry: SkillManifestEntry,
  linked: Set<string>,
  linking: Set<string>,
): Promise<LinkSkillResult> {
  if (linked.has(entry.name))
    return linkResult(targetRoot, entry.name, sourceRoot, canonicalSourceRoot, entry.path)
  if (linking.has(entry.name)) throw new Error(`Circular skill prerequisite: ${entry.name}`)
  linking.add(entry.name)
  try {
    for (const prerequisite of prerequisitesFor(manifest, entry)) {
      await linkManifestSkill(
        sourceRoot,
        canonicalSourceRoot,
        targetRoot,
        manifest,
        prerequisite,
        linked,
        linking,
      )
    }
    const result = await linkResult(
      targetRoot,
      entry.name,
      sourceRoot,
      canonicalSourceRoot,
      entry.path,
    )
    linked.add(entry.name)
    return result
  } finally {
    linking.delete(entry.name)
  }
}

async function linkResult(
  targetRoot: TargetDirectory,
  name: string,
  sourceRoot: string,
  canonicalSourceRoot: string,
  skillPath: string,
): Promise<LinkSkillResult> {
  const source = await resolveSkillSource(sourceRoot, canonicalSourceRoot, skillPath)
  const path = assertContained(targetRoot.path, name)
  return { created: await linkDirectoryEntry(source, targetRoot, name), path, source }
}

function prerequisitesFor(
  manifest: SkillManifest,
  entry: SkillManifestEntry,
): SkillManifestEntry[] {
  const entriesByName = new Map(manifest.skills.map((candidate) => [candidate.name, candidate]))
  return (entry.prerequisites ?? []).map((name) => entriesByName.get(name)!)
}

async function resolveSkillSource(
  sourceRoot: string,
  canonicalSourceRoot: string,
  skillPath: string,
): Promise<string> {
  const candidate = assertContained(sourceRoot, skillPath)
  let skill: string
  try {
    skill = await realpath(candidate)
  } catch {
    /* v8 ignore next 2 -- only an attacker replacing a validated source can reach this. */
    throw new Error(`Invalid skill source: ${skillPath}`)
  }
  /* v8 ignore next 2 -- only an attacker replacing a validated source can reach this. */
  if (!isContained(canonicalSourceRoot, skill) || !(await lstat(skill)).isFile())
    throw new Error(`Skill source escapes root: ${skillPath}`)
  // Validate through the canonical path, but retain the caller's logical root in
  // the link target. Package managers replace their physical store paths during
  // upgrades while the logical installed path remains stable.
  return dirname(candidate)
}
