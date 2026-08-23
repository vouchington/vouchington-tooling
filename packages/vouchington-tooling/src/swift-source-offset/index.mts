function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function isSwiftCodeOffset(source: string, offset: number): boolean {
  let blockCommentDepth = 0
  let escaped = false
  let inLineComment = false
  let inMultilineString = false
  let inString = false

  for (let index = 0; index < offset; index += 1) {
    const character = source[index]
    const pair = source.slice(index, index + 2)
    const triple = source.slice(index, index + 3)

    if (inLineComment) {
      if (character === '\n') inLineComment = false
      continue
    }
    if (blockCommentDepth > 0) {
      if (pair === '/*') {
        blockCommentDepth += 1
        index += 1
      } else if (pair === '*/') {
        blockCommentDepth -= 1
        index += 1
      }
      continue
    }
    if (inMultilineString) {
      if (triple === '"""') {
        inMultilineString = false
        index += 2
      }
      continue
    }
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (pair === '//') {
      inLineComment = true
      index += 1
    } else if (pair === '/*') {
      blockCommentDepth = 1
      index += 1
    } else if (triple === '"""') {
      inMultilineString = true
      index += 2
    } else if (character === '"') {
      inString = true
    }
  }

  return !inLineComment && blockCommentDepth === 0 && !inMultilineString && !inString
}

export function parseUniqueSwiftBinaryTargetChecksum(
  source: string,
  targetName: string,
  expectedUrl: string,
): string | undefined {
  const expression = new RegExp(
    `^\\s*package\\.targets\\s*\\+=\\s*\\[\\s*\\.binaryTarget\\(\\s*name:\\s*"${escapeRegExp(targetName)}"\\s*,\\s*url:\\s*"${escapeRegExp(expectedUrl)}"\\s*,\\s*checksum:\\s*"(?<checksum>[a-f0-9]{64})"\\s*\\)\\s*\\]\\s*$`,
    'gm',
  )
  const matches = [...source.matchAll(expression)].filter(
    (match) => match.index !== undefined && isSwiftCodeOffset(source, match.index),
  )
  return matches.length === 1 ? matches[0]?.groups?.checksum : undefined
}
