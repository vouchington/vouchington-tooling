export function readAnsiCString(
  command: string,
  startIndex: number,
): { value: string; endIndex: number } | null {
  let value = ''

  for (let index = startIndex; index < command.length; index += 1) {
    const char = command[index]
    if (char === "'") {
      return { value, endIndex: index }
    }

    if (char !== '\\') {
      value += char
      continue
    }

    if (index === command.length - 1) {
      value += '\\'
      continue
    }

    const escape = decodeAnsiCStringEscape(command, index + 1)
    value += escape.value
    index = escape.endIndex
  }

  return null
}

export function decodeAnsiCStringEscape(
  command: string,
  escapeIndex: number,
): {
  value: string
  endIndex: number
} {
  const char = command[escapeIndex]!
  switch (char) {
    case 'a':
      return { value: '\u0007', endIndex: escapeIndex }
    case 'b':
      return { value: '\b', endIndex: escapeIndex }
    case 'e':
    case 'E':
      return { value: '\u001b', endIndex: escapeIndex }
    case 'f':
      return { value: '\f', endIndex: escapeIndex }
    case 'n':
      return { value: '\n', endIndex: escapeIndex }
    case 'r':
      return { value: '\r', endIndex: escapeIndex }
    case 't':
      return { value: '\t', endIndex: escapeIndex }
    case 'v':
      return { value: '\v', endIndex: escapeIndex }
    case '\\':
    case "'":
    case '"':
    case '?':
      return { value: char, endIndex: escapeIndex }
    case '\n':
      return { value: '', endIndex: escapeIndex }
    case 'x':
      return decodeNumericAnsiEscape(command, escapeIndex + 1, 2, 16, '\\x')
    case 'u':
      return decodeNumericAnsiEscape(command, escapeIndex + 1, 4, 16, '\\u')
    case 'U':
      return decodeNumericAnsiEscape(command, escapeIndex + 1, 8, 16, '\\U')
    default:
      if (/[0-7]/.test(char)) {
        return decodeNumericAnsiEscape(command, escapeIndex, 3, 8, '\\')
      }

      return { value: char, endIndex: escapeIndex }
  }
}

export function decodeNumericAnsiEscape(
  command: string,
  startIndex: number,
  maxLength: number,
  radix: 8 | 16,
  fallbackPrefix: string,
): { value: string; endIndex: number } {
  const pattern = radix === 16 ? /[0-9a-fA-F]/ : /[0-7]/
  let digits = ''
  let endIndex = startIndex - 1

  for (
    let index = startIndex;
    index < command.length && digits.length < maxLength && pattern.test(command[index]!);
    index += 1
  ) {
    digits += command[index]!
    endIndex = index
  }

  if (digits.length === 0) {
    return { value: fallbackPrefix, endIndex: startIndex - 1 }
  }

  const codePoint = Number.parseInt(digits, radix)
  try {
    return { value: String.fromCodePoint(codePoint), endIndex }
  } catch {
    return { value: `${fallbackPrefix}${digits}`, endIndex }
  }
}
