import { posix } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { parse, parseAllDocuments } from 'yaml'

export type AstGrepConfigParityReason =
  | 'rule-dirs'
  | 'language-globs'
  | 'copied-pack-rule'
  | 'empty-local-rules'
  | 'rule-language'
  | 'tsx-companion'
  | 'invalid-yaml'

export interface AstGrepConfigParityOffender {
  /** The offending file (or the stale exception path). */
  name: string
  reason: AstGrepConfigParityReason
  detail: string
}

export interface AstGrepConfigParityFile {
  path: string
  source: string
}

export interface CheckAstGrepConfigParityOptions {
  sgconfig: { name: string; source: string }
  /** The tracked local rule directory, for example `ast-grep-rules`. */
  localRuleDir: string
  /** Local rule files, with paths relative to `localRuleDir`. */
  localRules: readonly AstGrepConfigParityFile[]
  /** Pack rule file paths, relative to the pack rules directory. */
  packRulePaths: readonly string[]
  /** Defaults to `DEFAULT_LANGUAGE_GLOBS`: the `Tsx` language over ts, mts, cts and tsx files. */
  expectedLanguageGlobs?: Readonly<Record<string, readonly string[]>>
  /** Defaults to `Tsx`. */
  defaultLanguage?: string
  /** Rule path (relative to `localRuleDir`) to its required language. Defaults to `{}`. */
  languageExceptions?: Readonly<Record<string, string>>
}

export const DEFAULT_LANGUAGE_GLOBS: Readonly<Record<string, readonly string[]>> = {
  Tsx: ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.tsx'],
}

const TSX_COMPANION = /-tsx\.ya?ml$/

type Parsed = { ok: true; value: unknown } | { ok: false; message: string }
type Out = AstGrepConfigParityOffender[]

function tryParse(source: string): Parsed {
  try {
    return { ok: true, value: parse(source) as unknown }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined
}

function show(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined'
}

function checkSgconfig(options: CheckAstGrepConfigParityOptions, out: Out): void {
  const { name, source } = options.sgconfig
  const parsed = tryParse(source)
  if (!parsed.ok) {
    out.push({ name, reason: 'invalid-yaml', detail: parsed.message })
    return
  }
  const ruleDirs = field(parsed.value, 'ruleDirs')
  if (!isDeepStrictEqual(ruleDirs, [options.localRuleDir])) {
    out.push({
      name,
      reason: 'rule-dirs',
      detail: `ruleDirs is ${show(ruleDirs)}, expected ${show([options.localRuleDir])}`,
    })
  }
  const expected = options.expectedLanguageGlobs ?? DEFAULT_LANGUAGE_GLOBS
  const globs = field(parsed.value, 'languageGlobs')
  if (!isDeepStrictEqual(globs, expected)) {
    out.push({
      name,
      reason: 'language-globs',
      detail: `languageGlobs is ${show(globs)}, expected ${show(expected)}`,
    })
  }
}

function checkRuleLanguage(rule: AstGrepConfigParityFile, expected: string, out: Out): void {
  const documents = parseAllDocuments(rule.source)
  const failed = documents.find((document) => document.errors.length > 0)
  if (failed) {
    out.push({ name: rule.path, reason: 'invalid-yaml', detail: failed.errors[0]!.message })
    return
  }
  if (documents.length === 0) {
    out.push({
      name: rule.path,
      reason: 'rule-language',
      detail: `language is undefined (no YAML documents), expected ${show(expected)}`,
    })
  }
  documents.forEach((document, index) => {
    const language = field(document.toJS(), 'language')
    if (language !== expected) {
      out.push({
        name: rule.path,
        reason: 'rule-language',
        detail: `document ${index}: language is ${show(language)}, expected ${show(expected)}`,
      })
    }
  })
}

/**
 * Checks an ast-grep configuration against the shipped rule pack. Pure and synchronous: callers
 * supply file contents (see `discoverAstGrepConfig`). Returns offenders; an empty array passes.
 */
export function checkAstGrepConfigParity(options: CheckAstGrepConfigParityOptions): Out {
  const out: Out = []
  checkSgconfig(options, out)
  if (options.localRules.length === 0) {
    out.push({
      name: options.localRuleDir,
      reason: 'empty-local-rules',
      detail: 'no local rule files were provided',
    })
  }
  const packPaths = new Set(options.packRulePaths)
  const packNames = new Set(options.packRulePaths.map((path) => posix.basename(path)))
  const defaultLanguage = options.defaultLanguage ?? 'Tsx'
  const exceptions = options.languageExceptions ?? {}
  for (const rule of options.localRules) {
    if (packPaths.has(rule.path) || packNames.has(posix.basename(rule.path))) {
      out.push({
        name: rule.path,
        reason: 'copied-pack-rule',
        detail: 'matches a rule shipped in the pack; load the pack directory instead of copying',
      })
    }
    if (TSX_COMPANION.test(rule.path)) {
      out.push({
        name: rule.path,
        reason: 'tsx-companion',
        detail: 'remove the -tsx companion rule; the base rule already covers Tsx',
      })
    }
    const expected = Object.hasOwn(exceptions, rule.path)
      ? (exceptions[rule.path] as string)
      : defaultLanguage
    checkRuleLanguage(rule, expected, out)
  }
  const known = new Set(options.localRules.map((rule) => rule.path))
  for (const path of Object.keys(exceptions)) {
    if (!known.has(path)) {
      out.push({
        name: path,
        reason: 'rule-language',
        detail: 'language exception names a file that is not a local rule',
      })
    }
  }
  return out
}
