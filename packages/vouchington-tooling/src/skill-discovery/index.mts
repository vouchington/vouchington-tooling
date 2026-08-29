import { lstat, mkdir, readFile, realpath, symlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

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
  const root = resolve(sourceRoot)
  const parsed: unknown = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
  if (!isManifest(parsed)) throw new Error('Invalid skills manifest')
  for (const entry of parsed.skills) assertContained(root, entry.path)
  return parsed
}

export async function linkSkill(options: LinkSkillOptions): Promise<LinkSkillResult> {
  if (!isSafeSkillName(options.name)) throw new Error(`Invalid skill name: ${options.name}`)
  const sourceRoot = await realpath(resolve(options.sourceRoot))
  const manifest = await readSkillManifest(sourceRoot)
  const entry = manifest.skills.find((candidate) => candidate.name === options.name)
  if (entry === undefined) throw new Error(`Unknown skill: ${options.name}`)
  const source = await resolveSkillSource(sourceRoot, entry.path)
  const targetRoot = await resolveTargetRoot(options.targetRoot)
  const path = assertContained(targetRoot, options.name)
  try {
    const stat = await lstat(path)
    if (!stat.isSymbolicLink()) throw new Error(`Destination already exists: ${path}`)
    if ((await realpath(path)) !== source) throw new Error(`Destination already exists: ${path}`)
    return { created: false, path, source }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await symlink(source, path, 'dir')
  return { created: true, path, source }
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
  await mkdir(root, { recursive: true })
  return realpath(root)
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
  return pathRelative === '' || (!pathRelative.startsWith('..') && !isAbsolute(pathRelative))
}

function isSafeSkillName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}
