export function withoutShellComment(command: string): string {
  return command
    .replace(/\\\r?\n/g, '')
    .split('\n')
    .map(withoutShellCommentLine)
    .join('\n')
}

function withoutShellCommentLine(command: string): string {
  let quote = ''
  for (let index = 0; index < command.length; index++) {
    const character = command[index]!
    if (character === '\\' && quote !== "'") {
      index++
      continue
    }
    if (quote !== '') {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") quote = character
    else if (character === '#' && (index === 0 || /\s/.test(command[index - 1]!)))
      return command.slice(0, index)
  }
  return command
}

export function shellSegments(command: string): string[] {
  const segments: string[] = []
  let quote = ''
  let start = 0
  for (let index = 0; index < command.length; index++) {
    const character = command[index]!
    if (character === '\\' && quote !== "'") {
      index++
      continue
    }
    if (quote !== '') {
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    const operatorLength =
      character === ';' ||
      character === '\n' ||
      character === '|' ||
      (character === '&' && command[index + 1] === '&')
        ? command[index + 1] === character && character !== ';'
          ? 2
          : 1
        : 0
    if (operatorLength === 0) continue
    segments.push(command.slice(start, index))
    index += operatorLength - 1
    start = index + 1
  }
  segments.push(command.slice(start))
  return segments
}
