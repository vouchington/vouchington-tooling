import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { createDirectoryLink } from './link.mts'

export type SkillManifestEntry = {
  name: string
  plugin: string
  pluginVersion: string
  path: string
}

export type SkillManifest = { version: 1; skills: SkillManifestEntry[] }

export type LinkSkillOptions = {
  name: string
  sourceRoot: string
  targetRoot: string
}

export type LinkSkillResult = { created: boolean; path: string; source: string }

export async function readSkillManifest(sourceRoot: string): Promise<SkillManifest> {
  const root = await realpath(resolve(sourceRoot))
  const parsed: unknown = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
  if (!isManifest(parsed)) throw new Error('Invalid skills manifest')
  await validateManifestEntries(root, parsed.skills)
  return parsed
}

export async function linkSkill(options: LinkSkillOptions): Promise<LinkSkillResult> {
  if (!isSafeSkillName(options.name)) throw new Error(`Invalid skill name: ${options.name}`)
  const sourceRoot = await realpath(resolve(options.sourceRoot))
  const manifest = await readSkillManifest(sourceRoot)
  const entry = manifest.skills.find((candidate) => candidate.name === options.name)
  if (entry === undefined) throw new Error(`Unknown skill: ${options.name}`)
  const targetRoot = await resolveTargetRoot(options.targetRoot)
  const linked = new Set<string>()
  const linking = new Set<string>()
  return linkManifestSkill(sourceRoot, targetRoot, manifest, entry, linked, linking)
}

async function linkManifestSkill(
  sourceRoot: string,
  targetRoot: string,
  manifest: SkillManifest,
  entry: SkillManifestEntry,
  linked: Set<string>,
  linking: Set<string>,
): Promise<LinkSkillResult> {
  if (linked.has(entry.name)) return linkResult(targetRoot, entry.name, sourceRoot, entry.path)
  if (linking.has(entry.name)) throw new Error(`Circular skill prerequisite: ${entry.name}`)
  linking.add(entry.name)
  try {
    for (const prerequisite of await prerequisitesFor(sourceRoot, manifest, entry)) {
      await linkManifestSkill(sourceRoot, targetRoot, manifest, prerequisite, linked, linking)
    }
    const result = await linkResult(targetRoot, entry.name, sourceRoot, entry.path)
    linked.add(entry.name)
    return result
  } finally {
    linking.delete(entry.name)
  }
}

async function linkResult(
  targetRoot: string,
  name: string,
  sourceRoot: string,
  skillPath: string,
): Promise<LinkSkillResult> {
  const source = await resolveSkillSource(sourceRoot, skillPath)
  const path = assertContained(targetRoot, name)
  try {
    const stat = await lstat(path)
    if (!stat.isSymbolicLink()) throw new Error(`Destination already exists: ${path}`)
    if ((await realpath(path)) !== source) throw new Error(`Destination already exists: ${path}`)
    return { created: false, path, source }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await createDirectoryLink(source, path)
  return { created: true, path, source }
}

async function prerequisitesFor(
  sourceRoot: string,
  manifest: SkillManifest,
  entry: SkillManifestEntry,
): Promise<SkillManifestEntry[]> {
  const source = await resolveSkillSource(sourceRoot, entry.path)
  const prerequisites: SkillManifestEntry[] = []
  for (const target of relativeSiblingSkillLinks(
    await readFile(join(source, 'SKILL.md'), 'utf8'),
  )) {
    const path = resolve(sourceRoot, dirname(entry.path), target)
    const prerequisite = manifest.skills.find(
      (candidate) => resolve(sourceRoot, candidate.path) === path,
    )
    if (prerequisite === undefined) throw new Error(`Missing prerequisite skill: ${target}`)
    prerequisites.push(prerequisite)
  }
  return prerequisites
}

function relativeSiblingSkillLinks(skill: string): string[] {
  return [...skill.matchAll(/\[[^\]]+]\((\.\.\/[^)#]+\/SKILL\.md)(?:#[^)]*)?\)/g)].map(
    (match) => match[1]!,
  )
}

async function resolveSkillSource(sourceRoot: string, skillPath: string): Promise<string> {
  if (basename(skillPath) !== 'SKILL.md') throw new Error(`Invalid skill source: ${skillPath}`)
  const candidate = assertContained(sourceRoot, skillPath)
  let skill: string
  try {
    skill = await realpath(candidate)
  } catch {
    throw new Error(`Invalid skill source: ${skillPath}`)
  }
  if (!isContained(sourceRoot, skill) || !(await lstat(skill)).isFile())
    throw new Error(`Skill source escapes root: ${skillPath}`)
  return dirname(skill)
}

async function resolveTargetRoot(targetRoot: string): Promise<string> {
  const root = resolve(targetRoot)
  await assertNoSymlinkAncestors(root)
  await mkdir(root, { recursive: true })
  await assertNoSymlinkAncestors(root)
  return root
}

async function validateManifestEntries(root: string, entries: SkillManifestEntry[]): Promise<void> {
  const names = new Set<string>()
  const lexicalPaths = new Set<string>()
  const canonicalPaths = new Set<string>()
  for (const entry of entries) {
    if (!isSafeSkillName(entry.name)) throw new Error(`Invalid skill name: ${entry.name}`)
    if (names.has(entry.name)) throw new Error(`Duplicate skill name: ${entry.name}`)
    names.add(entry.name)
    const path = assertContained(root, entry.path)
    if (lexicalPaths.has(path)) throw new Error(`Duplicate skill path: ${entry.path}`)
    lexicalPaths.add(path)
    try {
      const canonicalPath = await realpath(path)
      if (!isContained(root, canonicalPath))
        throw new Error(`Skill source escapes root: ${entry.path}`)
      if (canonicalPaths.has(canonicalPath)) throw new Error(`Duplicate skill path: ${entry.path}`)
      canonicalPaths.add(canonicalPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

async function assertNoSymlinkAncestors(path: string): Promise<void> {
  const parsed = parse(path)
  let ancestor = parsed.root
  for (const component of relative(parsed.root, path).split(sep)) {
    ancestor = join(ancestor, component)
    try {
      const stat = await lstat(ancestor)
      if (stat.isSymbolicLink()) throw new Error(`Target root contains symlink: ${ancestor}`)
      if (!stat.isDirectory()) throw new Error(`Invalid target root: ${ancestor}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}

function isManifest(value: unknown): value is SkillManifest {
  if (value === null || typeof value !== 'object') return false
  const manifest = value as Partial<SkillManifest>
  return manifest.version === 1 && Array.isArray(manifest.skills) && manifest.skills.every(isEntry)
}

function isEntry(value: unknown): value is SkillManifestEntry {
  if (value === null || typeof value !== 'object') return false
  const entry = value as Partial<SkillManifestEntry>
  return [entry.name, entry.plugin, entry.pluginVersion, entry.path].every(
    (field) => typeof field === 'string' && field.length > 0,
  )
}

function assertContained(root: string, child: string): string {
  if (isAbsolute(child)) throw new Error(`Skill path escapes root: ${child}`)
  const path = resolve(root, child)
  if (!isContained(root, path)) throw new Error(`Skill path escapes root: ${child}`)
  return path
}

function isContained(root: string, path: string): boolean {
  const pathRelative = relative(root, path)
  return !pathRelative.startsWith('..') && !isAbsolute(pathRelative)
}

function isSafeSkillName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}
