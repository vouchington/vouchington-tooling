import { formatReferenceKey } from './closing-refs.mts'

const NON_CLOSING_REF_RE =
  /\b(?:refs?|part\s+of):?[ \t]+(?:(?<ownerRepo>[\w.-]+\/[\w.-]+))?#(?<number>\d+)\b/gi

/**
 * Collects non-closing references (`Ref`, `Refs`, `Part of`, optionally followed by a colon) from
 * `referenceText`. Returns reference keys (`#N` or lowercased `owner/repo#N`, the format
 * `formatReferenceKey` produces) rather than bare numbers, so a `Refs owner/other-repo#42` cannot
 * disposition a same-numbered local `#42`; callers match by key.
 *
 * The caller decides which text counts: pass only the section that carries issue dispositions (for
 * example a "Related issues" section with code, comments and HTML blanked out), so an incidental
 * `Refs #N` elsewhere does not satisfy an audit.
 */
export function parseNonClosingRefs(referenceText: string): Set<string> {
  const keys = new Set<string>()
  for (const match of referenceText.matchAll(NON_CLOSING_REF_RE)) {
    const number = Number(match.groups?.number)
    if (!Number.isSafeInteger(number)) continue
    const ownerRepo = match.groups?.ownerRepo?.toLowerCase()
    const [owner, repo] = ownerRepo?.split('/') ?? [undefined, undefined]
    keys.add(formatReferenceKey({ number, owner, repo }))
  }
  return keys
}
