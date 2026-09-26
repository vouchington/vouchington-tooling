function previousToken(source: string, index: number): string | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (!/\s/u.test(source[cursor]!)) return source[cursor]
  }
  return undefined
}

function skipRegex(source: string, index: number): number {
  const previous = previousToken(source, index)
  if (previous && /[\w$)\]]/u.test(previous)) return index
  let characterClass = false
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1
      continue
    }
    if (source[cursor] === '[') characterClass = true
    if (source[cursor] === ']') characterClass = false
    if (source[cursor] === '/' && !characterClass) return cursor + 1
    if (source[cursor] === '\n') return index
  }
  return index
}

export function skipLiteralOrComment(source: string, index: number): number {
  const marker = source[index]
  if (marker === '/' && source[index + 1] === '/') {
    const end = source.indexOf('\n', index + 2)
    return end === -1 ? source.length : end
  }
  if (marker === '/' && source[index + 1] === '*') {
    const end = source.indexOf('*/', index + 2)
    return end === -1 ? source.length : end + 2
  }
  if (marker === '/') return skipRegex(source, index)
  if (marker !== "'" && marker !== '"' && marker !== '`') return index
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1
      continue
    }
    if (source[cursor] === marker) return cursor + 1
  }
  return source.length
}
