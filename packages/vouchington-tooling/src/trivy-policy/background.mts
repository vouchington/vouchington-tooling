export function hasBackgroundOperator(command: string): boolean {
  let quote = ''
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
    if (character === '"' || character === "'") quote = character
    else if (
      character === '&' &&
      command[index + 1] !== '&' &&
      command[index - 1] !== '&' &&
      !['<', '>'].includes(command[index - 1] ?? '') &&
      !['<', '>'].includes(command[index + 1] ?? '')
    )
      return true
  }
  return false
}
