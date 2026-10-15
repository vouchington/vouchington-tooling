export type ClosingIssueReference = {
  key: string
  number: number
  owner: string | undefined
  repo: string | undefined
}

const CLOSING_ISSUE_RE =
  /\b(?:close(?:s|d)?|fix(?:es|ed)?|resolve(?:s|d)?):?[ \t]+(?:(?<repo>[\w.-]+\/[\w.-]+)?#(?<number>\d+)|https?:\/\/github\.com\/(?<urlRepo>[\w.-]+\/[\w.-]+)\/issues\/(?<urlNumber>\d+))\b/gi

/**
 * GitHub closing keywords (close/closes/closed, fix/fixes/fixed, resolve/resolves/resolved,
 * optionally followed by a colon) followed by `#N`, `owner/repo#N` or a
 * `https://github.com/owner/repo/issues/N` URL. Owner and repo are lowercased and references are
 * deduplicated by key, in first-seen order.
 *
 * The body is scanned as raw text: closing keywords inside HTML comments or code spans/fences (for
 * example a PR template example) are reported too. Callers that must ignore them blank those spans
 * out before calling, as `parseNonClosingRefs` callers do with their scoped text.
 */
export function parseClosingIssueReferences(body: string): ClosingIssueReference[] {
  const refs: ClosingIssueReference[] = []
  const seen = new Set<string>()

  for (const match of body.matchAll(CLOSING_ISSUE_RE)) {
    const number = Number(match.groups?.number ?? match.groups?.urlNumber)
    if (!Number.isSafeInteger(number)) continue

    const repoRef = (match.groups?.repo ?? match.groups?.urlRepo)?.toLowerCase()
    const [owner, repo] = repoRef?.split('/') ?? [undefined, undefined]
    const key = formatReferenceKey({ number, owner, repo })
    if (seen.has(key)) continue
    seen.add(key)

    refs.push({ key, number, owner, repo })
  }

  return refs
}

export function hasClosingIssueReference(body: string): boolean {
  return parseClosingIssueReferences(body).length > 0
}

/** `#N` for a same-repository reference, otherwise lowercased `owner/repo#N`. */
export function formatReferenceKey(ref: {
  number: number
  owner?: string | undefined
  repo?: string | undefined
}): string {
  return ref.owner !== undefined && ref.repo !== undefined
    ? `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}`
    : `#${ref.number}`
}
