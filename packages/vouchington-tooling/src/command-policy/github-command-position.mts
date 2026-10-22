import { isGhCommandSeparator } from './github-options.mts'
import {
  type CommandPrefix,
  commandSegmentStart as shellSegmentStart,
  parseCommandPrefix,
} from '../shell-parse/index.mts'

export function commandSegmentStart(tokens: string[], index: number): number {
  return shellSegmentStart(tokens, index, isGhCommandSeparator)
}

/**
 * The wrapper chain before `tokens[index]` in its command segment, or null when `tokens[index]`
 * is an argument rather than the command the shell runs. See shell-command-wrappers.mts.
 */
export function commandPrefixAt(tokens: string[], index: number): CommandPrefix | null {
  return parseCommandPrefix(tokens.slice(commandSegmentStart(tokens, index), index))
}
