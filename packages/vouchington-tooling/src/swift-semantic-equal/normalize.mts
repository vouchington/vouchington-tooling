export function normalizeSwiftSource(source: string): string {
  let normalized = ''
  let index = 0

  while (index < source.length) {
    const char = source[index]
    if (char === undefined || /\s/u.test(char)) {
      index += 1
      continue
    }

    if (source.startsWith('//', index)) {
      index = skipLineComment(source, index)
      continue
    }

    if (source.startsWith('/*', index)) {
      index = skipBlockComment(source, index)
      continue
    }

    const hashCount = countLeadingHashes(source, index)
    const afterHashes = source[index + hashCount]
    if (afterHashes === '"') {
      const literal = readSwiftStringLiteral(source, index, hashCount)
      if (literal) {
        normalized += literal.text
        index = literal.end
        continue
      }
    }

    if (afterHashes === '/') {
      const literal = readSwiftRegexLiteral(source, index, hashCount, normalized)
      if (literal) {
        normalized += literal.text
        index = literal.end
        continue
      }
    }

    normalized += char
    index += 1
  }

  return normalized
}

function countLeadingHashes(source: string, start: number): number {
  let count = 0
  while (source[start + count] === '#') count += 1
  return count
}

function skipLineComment(source: string, start: number): number {
  const end = source.indexOf('\n', start + 2)
  return end === -1 ? source.length : end + 1
}

function skipBlockComment(source: string, start: number): number {
  let depth = 1
  let index = start + 2
  while (index < source.length && depth > 0) {
    if (source.startsWith('/*', index)) {
      depth += 1
      index += 2
    } else if (source.startsWith('*/', index)) {
      depth -= 1
      index += 2
    } else {
      index += 1
    }
  }
  return index
}

function readSwiftStringLiteral(
  source: string,
  start: number,
  hashCount: number,
): { end: number; text: string } | null {
  const openingQuote = start + hashCount
  const isTripleQuoted = source.startsWith('"""', openingQuote)
  const openerLength = hashCount + (isTripleQuoted ? 3 : 1)
  const closer = `${isTripleQuoted ? '"""' : '"'}${'#'.repeat(hashCount)}`
  let index = start + openerLength

  while (index < source.length) {
    if (!isTripleQuoted && hashCount === 0 && source[index] === '\\') {
      index += 2
      continue
    }
    if (source.startsWith(closer, index)) {
      return { end: index + closer.length, text: source.slice(start, index + closer.length) }
    }
    index += 1
  }

  return null
}

function readSwiftRegexLiteral(
  source: string,
  start: number,
  hashCount: number,
  normalizedPrefix: string,
): { end: number; text: string } | null {
  if (hashCount === 0 && !canStartBareRegex(normalizedPrefix)) return null
  const closer = `/${'#'.repeat(hashCount)}`
  let index = start + hashCount + 1

  while (index < source.length) {
    if (hashCount === 0 && source[index] === '\\') {
      index += 2
      continue
    }
    if (source.startsWith(closer, index)) {
      return { end: index + closer.length, text: source.slice(start, index + closer.length) }
    }
    index += 1
  }

  return null
}

function canStartBareRegex(normalizedPrefix: string): boolean {
  if (normalizedPrefix.length === 0) return true
  return /[({[=,:;!&|?]/u.test(normalizedPrefix.at(-1) as string)
}
