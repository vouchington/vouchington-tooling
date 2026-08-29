import { lstat, mkdir, readFile, readlink, symlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

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
  const sourceRoot = resolve(options.sourceRoot)
  const targetRoot = resolve(options.targetRoot)
  const manifest = await readSkillManifest(sourceRoot)
  const entry = manifest.skills.find((candidate) => candidate.name === options.name)
  if (entry === undefined) throw new Error(`Unknown skill: ${options.name}`)
  const source = dirname(assertContained(sourceRoot, entry.path))
  const path = assertContained(targetRoot, options.name)
  await mkdir(targetRoot, { recursive: true })
  try {
    const stat = await lstat(path)
    if (!stat.isSymbolicLink()) throw new Error(`Destination already exists: ${path}`)
    if (resolve(dirname(path), await readlink(path)) !== source)
      throw new Error(`Destination already exists: ${path}`)
    return { created: false, path, source }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await symlink(source, path, 'dir')
  return { created: true, path, source }
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
  if (relative(root, path).startsWith('..')) throw new Error(`Skill path escapes root: ${child}`)
  return path
}
