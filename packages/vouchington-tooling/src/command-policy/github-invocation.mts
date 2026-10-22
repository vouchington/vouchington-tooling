import {
  attachedShortOptionValue,
  isGhCommandSeparator,
  optionValueFromLongToken,
} from './github-options.mts'
import { isShellRedirectionOperatorToken } from '../shell-parse/index.mts'

export type GhInvocation = {
  action: string
  area: string
  arguments: string[]
  optionTokenIndexes: number[]
  optionTokens: string[]
}

type GhInvocationScan = Pick<GhInvocation, 'optionTokenIndexes' | 'optionTokens'> & {
  actionIndex?: number | undefined
  areaIndex?: number | undefined
}

export function parseGhOrGhStackInvocation(tokens: string[], index: number): GhInvocation | null {
  const executable = tokens[index]!.split('/').at(-1)
  if (executable === 'gh-stack') {
    return parseGhInvocation(ghStackAsGh(tokens, index), 0)
  }
  if (executable === 'gh') {
    return parseGhInvocation(tokens, index)
  }
  return null
}

export function parseGhInvocation(tokens: string[], ghIndex: number): GhInvocation | null {
  const { actionIndex, areaIndex, optionTokenIndexes, optionTokens } = scanGhInvocation(
    tokens,
    ghIndex,
  )
  if (areaIndex === undefined || actionIndex === undefined) {
    return null
  }

  return {
    action: tokens[actionIndex]!,
    area: tokens[areaIndex]!,
    arguments: tokens.slice(actionIndex + 1),
    optionTokenIndexes,
    optionTokens,
  }
}

function ghStackAsGh(tokens: string[], index: number): string[] {
  return ['gh', 'stack', ...tokens.slice(index + 1)]
}

function scanGhInvocation(tokens: string[], ghIndex: number): GhInvocationScan {
  let areaIndex: number | undefined
  let actionIndex: number | undefined
  const optionTokenIndexes: number[] = []
  const optionTokens: string[] = []

  for (let index = ghIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (isGhCommandSeparator(token)) {
      break
    }

    // A redirection target (e.g. the `--auto` in `gh pr merge 123 > --auto`) is a filename the
    // shell consumes, never an argument `gh` itself sees — drop the operator and its target so a
    // redirect can never be mistaken for a real flag.
    if (isShellRedirectionOperatorToken(token)) {
      index += 1
      continue
    }

    if (token === '--repo' || token === '-R') {
      optionTokens.push(token)
      optionTokenIndexes.push(index)
      const value = tokens[index + 1]
      if (value !== undefined && !isGhCommandSeparator(value)) {
        optionTokens.push(value)
        optionTokenIndexes.push(index + 1)
        index += 1
      }
      continue
    }

    if (
      optionValueFromLongToken(token, '--repo') !== null ||
      attachedShortOptionValue(token, '-R') !== null
    ) {
      optionTokens.push(token)
      optionTokenIndexes.push(index)
      continue
    }

    if (areaIndex === undefined) {
      areaIndex = index
      continue
    }
    if (actionIndex === undefined) {
      actionIndex = index
      continue
    }

    optionTokens.push(token)
    optionTokenIndexes.push(index)
  }

  return { actionIndex, areaIndex, optionTokenIndexes, optionTokens }
}
