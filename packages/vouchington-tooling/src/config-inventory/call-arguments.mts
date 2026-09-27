export function splitCallArguments(args: string): string[] {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let quote = ''
  for (let index = 0; index < args.length; index += 1) {
    const char = args[index]!
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char
    } else if ('<[{('.includes(char)) {
      depth += 1
    } else if ('>]})'.includes(char)) {
      depth = Math.max(0, depth - 1)
    } else if (char === ',' && depth === 0) {
      parts.push(args.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(args.slice(start).trim())
  return parts
}
