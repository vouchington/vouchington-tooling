import type { ShellWord } from './shell-tokenizer.mts'
import { isRedirectionFd, shellRedirectionOperatorAt } from './shell-redirections.mts'

type SeparatorState = {
  char: string
  command: string
  expandable: boolean
  index: number
  options: { splitRedirections?: boolean }
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
  if (char === '&' || char === '|' || char === ';' || char === '(' || char === ')') {
    pushStateToken(state)
    const previousToken = state.tokens.at(-1)?.value
    if ((char === '&' && previousToken === '&') || (char === '|' && previousToken === '|')) {
      state.tokens[state.tokens.length - 1] = {
        expandable: false,
        value: `${previousToken}${char}`,
      }
    } else {
      state.tokens.push({ expandable: false, value: char })
    }
    return state.index
  }

  return undefined
}
