import { isAbsolute, resolve } from 'node:path'

import { commandPrefixAt, commandSegmentStart } from './github-command-position.mts'
import {
  type CommandPrefix,
  isShellCommandSeparator,
  nextShellCommandSeparatorIndex,
} from '../shell-parse/index.mts'

const CD_JOINERS = new Set(['&&', ';', '\n', '('])
const CONDITIONAL_PREFIXES = new Set(['then', 'else', 'elif', 'do'])
const UNRESOLVED_DIRECTORY = /[$`~*?[{]/
// Wrappers that still run the shell's own `cd` builtin; the rest exec a separate `cd` process
// whose directory change dies with it.
const BUILTIN_CD_WRAPPERS = new Set(['builtin', 'command', 'time'])

/**
 * Working directory the `gh` token at `index` would see after sequential
 * command-local `cd` and its own `env -C` wrappers. `baseCwd` is session
 * `hookCwd`. Returns `undefined` when cwd is unknown so callers fail open
 * instead of using the session checkout. Absolute `cd` after `&&`/`;` and an
 * absolute `env -C` recover a known directory.
 */
export function commandCwd(tokens: string[], index: number, baseCwd: string): string | undefined {
  const shellCwd = sequentialShellCwd(tokens, index, baseCwd)
  const prefix = commandPrefixAt(tokens, index)
  return prefix === null ? shellCwd : applyEnvChdir(prefix, shellCwd)
}

function applyEnvChdir(prefix: CommandPrefix, shellCwd: string | undefined): string | undefined {
  let current = shellCwd
  for (const directory of prefix.chdir) {
    if (UNRESOLVED_DIRECTORY.test(directory)) return undefined
    if (isAbsolute(directory)) current = resolve(directory)
    else current = current === undefined ? undefined : resolve(current, directory)
  }
  return current
}

function sequentialShellCwd(tokens: string[], index: number, baseCwd: string): string | undefined {
  const stack: Array<string | undefined> = [baseCwd]
  let functionDepth = 0
  for (let cursor = 0; cursor < index; cursor += 1) {
    const token = tokens[cursor]
    if (token === '{') {
      // Inside a function body every nested `{` also opens a group, so its `}` must not end the body.
      if (functionDepth > 0 || tokens[cursor - 1] === ')' || tokens[cursor - 2] === 'function') {
        functionDepth += 1
      }
      continue
    }
    if (token === '}') {
      if (functionDepth > 0) functionDepth -= 1
      continue
    }
    if (token === '(') {
      stack.push(stack.at(-1))
      continue
    }
    if (token === ')') {
      if (stack.length > 1) stack.pop()
      continue
    }
    if (functionDepth > 0) continue
    if (token !== 'cd' || !runsBuiltinCd(tokens, cursor)) continue
    const joinerIndex = nextShellCommandSeparatorIndex(tokens, cursor)
    const joiner = joinerIndex < tokens.length ? tokens[joinerIndex] : undefined
    if (joiner === undefined || joinerIndex >= index) continue
    const previous = previousJoiner(tokens, cursor)
    if (previous === '|') continue
    if (joiner === '||' || previous === '||') {
      stack[stack.length - 1] = undefined
      continue
    }
    if (!CD_JOINERS.has(joiner)) continue
    if (cdIsConditional(tokens, cursor)) {
      stack[stack.length - 1] = undefined
      continue
    }
    const directory = cdDirectoryOperand(tokens, cursor)
    if (directory === undefined) {
      stack[stack.length - 1] = undefined
      continue
    }
    const current = stack.at(-1)
    if (isAbsolute(directory)) {
      stack[stack.length - 1] = resolve(directory)
      continue
    }
    stack[stack.length - 1] = current === undefined ? undefined : resolve(current, directory)
  }

  return stack.at(-1)
}

function runsBuiltinCd(tokens: string[], cdIndex: number): boolean {
  const prefix = commandPrefixAt(tokens, cdIndex)
  return prefix !== null && prefix.wrappers.every((wrapper) => BUILTIN_CD_WRAPPERS.has(wrapper))
}

function cdIsConditional(tokens: string[], cdIndex: number): boolean {
  return tokens
    .slice(commandSegmentStart(tokens, cdIndex), cdIndex)
    .some((token) => CONDITIONAL_PREFIXES.has(token))
}

function previousJoiner(tokens: string[], index: number): string | undefined {
  const start = commandSegmentStart(tokens, index)
  return start > 0 ? tokens[start - 1] : undefined
}

function cdDirectoryOperand(tokens: string[], cdIndex: number): string | undefined {
  let operandIndex = cdIndex + 1
  if (tokens[operandIndex] === '--') operandIndex += 1
  let physical = false
  while (tokens[operandIndex] === '-P' || tokens[operandIndex] === '-L') {
    if (tokens[operandIndex] === '-P') physical = true
    operandIndex += 1
  }
  const directory = tokens[operandIndex]
  const rest = tokens[operandIndex + 1]
  if (
    physical ||
    directory === undefined ||
    isShellCommandSeparator(directory) ||
    directory === '-' ||
    directory.startsWith('-') ||
    UNRESOLVED_DIRECTORY.test(directory) ||
    (rest !== undefined && !isShellCommandSeparator(rest))
  ) {
    return undefined
  }

  return directory
}
