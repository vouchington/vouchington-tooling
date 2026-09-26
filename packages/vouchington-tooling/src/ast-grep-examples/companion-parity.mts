import * as fs from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parse as yamlLoad } from 'yaml'
import { assertJsonValue, compare, compareCodeUnits } from './companion-parity-compare.mts'

export { compareCodeUnits }

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

function assertPhysicalPath(path: string): void {
  let ancestor = path
  while (true) {
    if (fs.lstatSync(ancestor).isSymbolicLink())
      throw new Error('rules: symbolic links are not allowed')
    const parent = dirname(ancestor)
    if (parent === ancestor) return
    ancestor = parent
  }
}

function yamlFiles(directory: string, relative = ''): string[] {
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .toSorted((a, b) => compareCodeUnits(a.name, b.name))
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
    const document = yamlLoad(fs.readFileSync(join(rules, file), 'utf8'), { maxAliasCount: 0 })
    assertJsonValue(document)
    return document
  } catch (error) {
    throw new Error(`${file}: invalid YAML: ${String(error)}`)
  }
}
function stem(file: string): string {
  return file.replace(YAML_EXTENSION, '')
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
  assertPhysicalPath(rules)
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
        `${baseStem}: duplicate companion rules: ${companionFiles.toSorted(compareCodeUnits).join(', ')}`,
      )
  const differences: AstGrepCompanionDifference[] = []
  for (const { file: companionFile, baseStem } of companions) {
    const bases = basesByStem.get(baseStem) ?? []
    if (!bases.length) throw new Error(`${companionFile}: missing base companion`)
    if (bases.length > 1)
      throw new Error(
        `${companionFile}: duplicate base companions: ${bases.toSorted(compareCodeUnits).join(', ')}`,
      )
    const baseFile = bases[0]!
    const normalize = options.normalize ?? ((document: unknown) => document)
    const base = normalize(loadDocument(rules, baseFile), { file: baseFile, role: 'base' })
    const companion = normalize(loadDocument(rules, companionFile), {
      file: companionFile,
      role: 'companion',
    })
    assertJsonValue(base)
    assertJsonValue(companion)
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
