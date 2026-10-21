import { readCommandPrefix, withoutRedirections } from './shell-command-wrappers.mts'
import { isShellWord, shellScriptOperandIndex } from './shell-script-operand.mts'
import { commandSegmentStart, nextShellCommandSeparatorIndex } from './shell-token-utils.mts'

// Words that close a compound command. Its redirections feed every command inside it.
const COMPOUND_CLOSERS = new Set(['done', 'esac', 'fi'])
const EXEC_WRAPPERS = new Set([
  'busybox',
  'chroot',
  'doas',
  'ionice',
  'nice',
  'setsid',
  'stdbuf',
  'su',
  'sudo',
  'timeout',
  'toybox',
  'xargs',
])
const EXPANSION = /[$`*?[]/

/**
 * Whether a shell may read the stdin redirection (heredoc or here-string) at `operatorIndex` of
 * `tokens` (tokenized with `splitRedirections`) as its script: the redirected command, or any later
 * stage of its pipeline, is one the hook cannot rule out as a scriptless shell.
 */
export function shellReadsStdinAt(tokens: string[], operatorIndex: number): boolean {
  let start = commandSegmentStart(tokens, operatorIndex)
  let end = nextShellCommandSeparatorIndex(tokens, operatorIndex)
  if (segmentMayRunStdin(tokens, start, end)) return true
  while (tokens[end] === '|') {
    // `|&` pipes stderr too.
    start = tokens[end + 1] === '&' ? end + 2 : end + 1
    // A pipeline that continues after the heredoc body names its next stage on a later line.
    if (start >= tokens.length) return true
    end = nextShellCommandSeparatorIndex(tokens, start)
    if (segmentMayRunStdin(tokens, start, end)) return true
  }
  return false
}

// A shell reads stdin as its script unless a `-c` script comes before its first operand. The hook
// also fails closed on a compound command (`{ bash; }`, `(bash)`, `done`), a wrapper option it
// cannot read (`env -S`), and a command word an expansion chooses (`$SHELL`).
function segmentMayRunStdin(tokens: string[], start: number, end: number): boolean {
  if (tokens[start - 1] === ')' || tokens[start - 1] === '}') return true
  const words = withoutRedirections(tokens.slice(start, end))
  if (words === null || words.length === 0 || COMPOUND_CLOSERS.has(words[0]!)) return true
  const read = readCommandPrefix(words)
  if (read === null) return true
  const command = words[read.commandIndex]
  if (command === undefined || EXPANSION.test(command)) return true
  if (EXEC_WRAPPERS.has(command.slice(command.lastIndexOf('/') + 1))) return true
  return isShellWord(command) && shellScriptOperandIndex(words, read.commandIndex) === undefined
}
