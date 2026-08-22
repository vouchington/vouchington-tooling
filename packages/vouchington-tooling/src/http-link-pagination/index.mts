/**
 * Resolve the `rel=next` target in an RFC 8288 Link header without permitting a
 * response to redirect an authenticated pagination client to another origin.
 *
 * A malformed or unsafe Link header is treated as having no next page. Callers
 * can therefore stop safely without having to distinguish an exhausted list
 * from a provider that returned an unusable continuation.
 */
export function nextPageUrlFromLinkHeader(
  linkHeader: string | null | undefined,
  requestUrl: string | URL,
): URL | null {
  const baseUrl = validatePaginationRequestUrl(requestUrl)
  // Preserve the public fail-closed result for an empty header while letting the
  // parser own the empty-input case.
  if (linkHeader == null) return null

  const links = parseLinkHeader(linkHeader)
  if (!links) return null

  const nextLinks = links.filter((link) => link.relations.includes('next'))
  if (nextLinks.length !== 1) return null

  let nextUrl: URL
  try {
    nextUrl = new URL(nextLinks[0]!.target, baseUrl)
  } catch {
    return null
  }

  if (
    nextUrl.origin !== baseUrl.origin ||
    nextUrl.username !== '' ||
    nextUrl.password !== '' ||
    nextUrl.hash !== ''
  ) {
    return null
  }

  return nextUrl
}

/**
 * Return an unambiguous next-page cursor from a safe Link header target.
 *
 * A missing, empty, or repeated query parameter is rejected. This prevents a
 * caller from accidentally advancing with a cursor whose interpretation
 * depends on a provider's duplicate-query-parameter semantics.
 */
export function nextPageCursorFromLinkHeader(
  linkHeader: string | null | undefined,
  requestUrl: string | URL,
  cursorParameter = 'page',
): string | null {
  const nextUrl = nextPageUrlFromLinkHeader(linkHeader, requestUrl)
  if (!nextUrl) return null

  const values = nextUrl.searchParams.getAll(cursorParameter)
  return values.length === 1 && values[0] !== '' ? values[0]! : null
}

/** Validate a pagination request URL before it is used as a Link resolution base. */
export function validatePaginationRequestUrl(requestUrl: string | URL): URL {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    throw new Error('pagination request URL must be an absolute HTTP(S) URL without credentials')
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    throw new Error('pagination request URL must be an absolute HTTP(S) URL without credentials')
  }

  return url
}

interface ParsedLink {
  target: string
  relations: string[]
}

function parseLinkHeader(header: string): ParsedLink[] | null {
  const links: ParsedLink[] = []
  let index = 0

  while (index < header.length) {
    index = skipWhitespace(header, index)
    if (header[index] !== '<') return null

    const targetEnd = header.indexOf('>', index + 1)
    if (targetEnd === -1) return null
    const target = header.slice(index + 1, targetEnd)
    if (target === '') return null
    index = targetEnd + 1

    const relations: string[] = []
    while (true) {
      index = skipWhitespace(header, index)
      if (index === header.length || header[index] === ',') break
      if (header[index] !== ';') return null
      index = skipWhitespace(header, index + 1)

      const name = readToken(header, index)
      if (!name) return null
      index = name.end
      index = skipWhitespace(header, index)
      if (header[index] !== '=') return null
      index = skipWhitespace(header, index + 1)

      const value = readParameterValue(header, index)
      if (!value) return null
      index = value.end
      if (name.value.toLowerCase() === 'rel') {
        relations.push(...value.value.toLowerCase().split(/\s+/).filter(Boolean))
      }
    }

    links.push({ target, relations })
    if (index === header.length) return links
    index += 1
    if (index === header.length) return null
  }

  return null
}

function skipWhitespace(value: string, index: number): number {
  while (value[index] === ' ' || value[index] === '\t') index += 1
  return index
}

function readToken(value: string, index: number): { value: string; end: number } | null {
  const start = index
  while (index < value.length && isTokenCharacter(value[index]!)) index += 1
  return index === start ? null : { value: value.slice(start, index), end: index }
}

function isTokenCharacter(value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]$/.test(value)
}

function readParameterValue(value: string, index: number): { value: string; end: number } | null {
  if (value[index] !== '"') return readToken(value, index)

  let parsed = ''
  index += 1
  while (index < value.length) {
    const character = value[index]!
    if (character === '"') return { value: parsed, end: index + 1 }
    if (character === '\\') {
      const escaped = value[index + 1]
      if (!escaped) return null
      parsed += escaped
      index += 2
      continue
    }
    parsed += character
    index += 1
  }
  return null
}
