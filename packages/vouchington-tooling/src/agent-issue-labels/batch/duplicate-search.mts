export type DuplicateSearchConfig = {
  query: string
  acknowledgedHits: number[]
  acknowledgedSiblings: string[]
}

export function parseDuplicateSearch(
  raw: unknown,
  title: string,
  id: string,
  index: number,
): DuplicateSearchConfig {
  if (raw === undefined || raw === null) {
    return { query: title, acknowledgedHits: [], acknowledgedSiblings: [] }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`entries[${index}] ("${id}").duplicateSearch must be an object if present.`)
  }
  const record = raw as Record<string, unknown>

  const query = record.query ?? title
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new Error(`entries[${index}] ("${id}").duplicateSearch.query must be a non-empty string.`)
  }

  const acknowledgedHits = record.acknowledgedHits ?? []
  if (!Array.isArray(acknowledgedHits) || acknowledgedHits.some((hit) => typeof hit !== 'number')) {
    throw new Error(
      `entries[${index}] ("${id}").duplicateSearch.acknowledgedHits must be an array of numbers if present.`,
    )
  }

  const acknowledgedSiblings = record.acknowledgedSiblings ?? []
  if (
    !Array.isArray(acknowledgedSiblings) ||
    acknowledgedSiblings.some((sibling) => typeof sibling !== 'string')
  ) {
    throw new Error(
      `entries[${index}] ("${id}").duplicateSearch.acknowledgedSiblings must be an array of strings if present.`,
    )
  }

  return {
    query,
    acknowledgedHits: acknowledgedHits as number[],
    acknowledgedSiblings: acknowledgedSiblings as string[],
  }
}
