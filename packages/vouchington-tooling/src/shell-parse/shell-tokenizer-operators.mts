import type { ShellTokenizeOptions, ShellWord } from './shell-tokenizer.mts'
import { isRedirectionFd, shellRedirectionOperatorAt } from './shell-redirections.mts'

type SeparatorState = {
  char: string
  command: string
  expandable: boolean
  index: number
  options: ShellTokenizeOptions
  token: string
  tokens: ShellWord[]
}

function pushStateToken(state: SeparatorState): void {
  if (state.token === '') return
  state.tokens.push({ expandable: state.expandable, value: state.token })
  state.token = ''
  state.expandable = false
}

export function consumeShellSeparator(state: SeparatorState): number | undefined {
  const redirectionOperator =
    state.options.splitRedirections === true
      ? shellRedirectionOperatorAt(state.command, state.index)
      : null
  if (redirectionOperator !== null) {
    if (isRedirectionFd(state.token)) {
      state.tokens.push({
        expandable: state.expandable,
        value: `${state.token}${redirectionOperator}`,
      })
      state.token = ''
      state.expandable = false
    } else if (state.token !== '') {
      pushStateToken(state)
      state.tokens.push({ expandable: false, value: redirectionOperator })
    } else {
      state.tokens.push({ expandable: false, value: redirectionOperator })
    }
    return state.index + redirectionOperator.length - 1
  }

  const { char } = state
  const isParenthesis = char === '(' || char === ')'
  if (
    char === '&' ||
    char === '|' ||
    char === ';' ||
    (isParenthesis && !state.options.keepParentheses)
  ) {
    pushStateToken(state)
    const operator = state.options.markOperators ? ({ operator: true } as const) : {}
    const previous = state.tokens.at(-1)
    const previousToken = previous?.value
    // With `markOperators` a quoted `"|"` argument is not an operator, so only operators merge.
    const mergeable = state.options.markOperators !== true || previous?.operator === true
    if (
      mergeable &&
      ((char === '&' && previousToken === '&') || (char === '|' && previousToken === '|'))
    ) {
      state.tokens[state.tokens.length - 1] = {
        expandable: false,
        ...operator,
        value: `${previousToken}${char}`,
      }
    } else {
      state.tokens.push({ expandable: false, ...operator, value: char })
    }
    return state.index
  }

  return undefined
}
