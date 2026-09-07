import * as fs from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as yamlLoad } from 'yaml'

export interface AstGrepCompanionDifference {
  readonly baseFile: string
  readonly companionFile: string
  readonly path: string
  readonly base: unknown
  readonly companion: unknown
}
export interface AstGrepCompanionParityOptions {
  readonly rules: string
  readonly companionSuffix?: string
  readonly normalize?: (document: unknown, context: AstGrepCompanionContext) => unknown
}
export interface AstGrepCompanionContext {
  readonly file: string
  readonly role: 'base' | 'companion'
}

const YAML_EXTENSION = /\.ya?ml$/u

function yamlFiles(directory: string, relative = ''): string[] {
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .toSorted((a, b) => a.name.localeCompare(b.name))
  const files: string[] = []
  for (const entry of entries) {
    const file = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new Error(`${file}: symbolic links are not allowed`)
    if (entry.isDirectory()) files.push(...yamlFiles(join(directory, entry.name), file))
    else if (entry.isFile() && YAML_EXTENSION.test(entry.name)) files.push(file)
  }
  return files
}
function loadDocument(rules: string, file: string): unknown {
  try {
    return yamlLoad(fs.readFileSync(join(rules, file), 'utf8'))
  } catch (error) {
    throw new Error(`${file}: invalid YAML: ${String(error)}`)
  }
}
function stem(file: string): string {
  return file.replace(YAML_EXTENSION, '')
}
function pointer(path: string, key: string | number): string {
  const segment = String(key).replaceAll('~', '~0').replaceAll('/', '~1')
  return `${path}/${segment}`
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function compare(
  base: unknown,
  companion: unknown,
  path: string,
  difference: (path: string, base: unknown, companion: unknown) => void,
): void {
  if (Object.is(base, companion)) return
  if (Array.isArray(base) && Array.isArray(companion)) {
    const length = Math.max(base.length, companion.length)
    for (let index = 0; index < length; index++)
      compare(base[index], companion[index], pointer(path, index), difference)
    return
  }
  if (isRecord(base) && isRecord(companion)) {
    for (const key of [...new Set([...Object.keys(base), ...Object.keys(companion)])].toSorted())
      compare(base[key], companion[key], pointer(path, key), difference)
    return
  }
  difference(path, base, companion)
}
function assertSuffix(suffix: string): void {
  if (!suffix || /[\\/]/u.test(suffix))
    throw new Error('companionSuffix must be a non-empty filename suffix')
}

/** Compares recursive `<name>.yml`/`.yaml` rules with `<name>-tsx` companions. */
export function compareAstGrepCompanions(
  options: AstGrepCompanionParityOptions,
): AstGrepCompanionDifference[] {
  const suffix = options.companionSuffix ?? '-tsx'
  assertSuffix(suffix)
  const rules = resolve(options.rules)
  if (fs.lstatSync(rules).isSymbolicLink()) throw new Error('rules: symbolic links are not allowed')
  const files = yamlFiles(rules)
  const basesByStem = new Map<string, string[]>()
  const companions: Array<{ file: string; baseStem: string }> = []
  for (const file of files) {
    const fileStem = stem(file)
    if (fileStem.endsWith(suffix))
      companions.push({ file, baseStem: fileStem.slice(0, -suffix.length) })
    else basesByStem.set(fileStem, [...(basesByStem.get(fileStem) ?? []), file])
  }
  const companionsByStem = new Map<string, string[]>()
  for (const { file, baseStem } of companions)
    companionsByStem.set(baseStem, [...(companionsByStem.get(baseStem) ?? []), file])
  for (const [baseStem, companionFiles] of companionsByStem)
    if (companionFiles.length > 1)
      throw new Error(
        `${baseStem}: duplicate companion rules: ${companionFiles.toSorted().join(', ')}`,
      )
  const differences: AstGrepCompanionDifference[] = []
  for (const { file: companionFile, baseStem } of companions) {
    const bases = basesByStem.get(baseStem) ?? []
    if (!bases.length) throw new Error(`${companionFile}: missing base companion`)
    if (bases.length > 1)
      throw new Error(`${companionFile}: duplicate base companions: ${bases.toSorted().join(', ')}`)
    const baseFile = bases[0]!
    const normalize = options.normalize ?? ((document: unknown) => document)
    const base = normalize(loadDocument(rules, baseFile), { file: baseFile, role: 'base' })
    const companion = normalize(loadDocument(rules, companionFile), {
      file: companionFile,
      role: 'companion',
    })
    compare(base, companion, '', (path, baseValue, companionValue) => {
      differences.push({
        baseFile,
        companionFile,
        path,
        base: baseValue,
        companion: companionValue,
      })
    })
  }
  return differences
}
