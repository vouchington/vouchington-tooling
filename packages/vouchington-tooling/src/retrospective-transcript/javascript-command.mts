const EXEC_OBJECT =
  /tools\.exec_command\(\s*(\{(?:(?:\\.|[^{}"'`\\])|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)*\})\s*\)/g
const COMMAND_LITERAL = /(?:[,{])\s*(?:cmd|['"]cmd['"])\s*:\s*([`'"])((?:\\.|(?!\1)[^\\])*)\1/
const INTERPOLATION = /(^|[^\\])\$\{/

function decodeLiteral(quote: string, value: string): string | undefined {
  if (quote === '`' && INTERPOLATION.test(value)) return undefined
  return value.replace(
    /\\([\\'"`bnrtv])/g,
    (_, character: string) =>
      ({
        '\\': '\\',
        "'": "'",
        '"': '"',
        '`': '`',
        b: '\b',
        n: '\n',
        r: '\r',
        t: '\t',
        v: '\v',
      })[character] as string,
  )
}

export function customExecCommands(raw: string): string[] {
  return [...raw.matchAll(EXEC_OBJECT)].flatMap((call) => {
    const match = call[1]!.match(COMMAND_LITERAL)
    const command = match ? decodeLiteral(match[1]!, match[2]!) : undefined
    return command === undefined ? [] : [command]
  })
}
