import { parseDuplicateSearch, type DuplicateSearchConfig } from './duplicate-search.mts'
import { DEFAULT_BATCH_POLICY, type BatchPolicy } from './policy.mts'
export type BatchEntry = {
  id: string
  title: string
  bodyFile: string
  paths: string[]
  priority: string
  dependencies: string[]
  milestone: string | null
  extraLabels: string[]
  duplicateSearch: DuplicateSearchConfig
}

export type BatchManifest = {
  targetRepo: string
  entries: BatchEntry[]
}

// Keep entry ids identifier-safe so reports and future read-only tooling can address entries
// without escaping or ambiguous keys.
const ENTRY_ID = /^[A-Za-z_][A-Za-z0-9_]*$/

// `gh issue list --search` returns related, not only duplicate, issues, so preflight cannot
// fail-closed by treating every hit as a duplicate. `acknowledgedHits`/`acknowledgedSiblings`
// capture the author's explicit non-duplicate judgment inside the manifest; a hit or intra-batch
// collision blocks unless acknowledged here. Omitting the field entirely defaults to the
// strictest behavior (search by title, acknowledge nothing) rather than skipping the check.
function parseEntry(raw: Record<string, unknown>, index: number, policy: BatchPolicy): BatchEntry {
  const { id } = raw
  if (typeof id !== 'string' || !ENTRY_ID.test(id)) {
    throw new Error(
      `entries[${index}].id must match ${ENTRY_ID} (identifier-safe), got ${JSON.stringify(id)}.`,
    )
  }

  const { title } = raw
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new Error(`entries[${index}] ("${id}").title must be a non-empty string.`)
  }

  const { bodyFile } = raw
  if (typeof bodyFile !== 'string' || bodyFile.trim().length === 0) {
    throw new Error(`entries[${index}] ("${id}").bodyFile must be a non-empty string.`)
  }
  if (bodyFile.includes('..') || bodyFile.startsWith('/')) {
    throw new Error(
      `entries[${index}] ("${id}").bodyFile cannot contain path traversal components.`,
    )
  }

  const { paths } = raw
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) {
    throw new Error(`entries[${index}] ("${id}").paths must be an array of strings.`)
  }

  const { priority } = raw
  if (typeof priority !== 'string' || !policy.priorityLabels.includes(priority)) {
    throw new Error(
      `entries[${index}] ("${id}").priority must be one of ${policy.priorityLabels.join(', ')}, got ${JSON.stringify(priority)}.`,
    )
  }

  const dependencies = raw.dependencies ?? []
  if (!Array.isArray(dependencies) || dependencies.some((dep) => typeof dep !== 'string')) {
    throw new Error(
      `entries[${index}] ("${id}").dependencies must be an array of strings if present.`,
    )
  }

  const milestone = raw.milestone ?? null
  if (milestone !== null && typeof milestone !== 'string') {
    throw new Error(`entries[${index}] ("${id}").milestone must be a string or null.`)
  }

  const extraLabels = raw.extraLabels ?? []
  if (!Array.isArray(extraLabels) || extraLabels.some((label) => typeof label !== 'string')) {
    throw new Error(
      `entries[${index}] ("${id}").extraLabels must be an array of strings if present.`,
    )
  }

  return {
    id,
    title,
    bodyFile,
    paths: paths as string[],
    priority,
    dependencies: dependencies as string[],
    milestone: milestone as string | null,
    extraLabels: extraLabels as string[],
    duplicateSearch: parseDuplicateSearch(raw.duplicateSearch, title, id, index),
  }
}

export type ParseManifestOptions = {
  /** `owner/name` repositories a manifest may target; anything else is rejected. */
  allowedRepos: readonly string[]
  /** Priority and dependency label names; defaults to `DEFAULT_BATCH_POLICY`. */
  policy?: BatchPolicy | undefined
}

/** Parses and validates a batch manifest JSON document. Throws on any schema violation. */
export function parseManifest(raw: string, options: ParseManifestOptions): BatchManifest {
  const parsed = JSON.parse(raw) as Record<string, unknown>

  const { targetRepo } = parsed
  if (typeof targetRepo !== 'string' || !options.allowedRepos.includes(targetRepo)) {
    throw new Error(
      `manifest.targetRepo must be one of ${options.allowedRepos.map((repo) => JSON.stringify(repo)).join(', ')}, got ${JSON.stringify(targetRepo)}.`,
    )
  }

  const rawEntries = parsed.entries
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    throw new Error('manifest.entries must be a non-empty array.')
  }

  const entries = rawEntries.map((rawEntry, index) =>
    parseEntry(rawEntry as Record<string, unknown>, index, options.policy ?? DEFAULT_BATCH_POLICY),
  )

  const seenIds = new Set<string>()
  for (const entry of entries) {
    if (seenIds.has(entry.id)) throw new Error(`Duplicate manifest entry id "${entry.id}".`)
    seenIds.add(entry.id)
  }

  return { targetRepo, entries }
}
