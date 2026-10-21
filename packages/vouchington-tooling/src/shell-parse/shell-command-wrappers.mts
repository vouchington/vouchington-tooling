import { isShellRedirectionOperatorToken } from './shell-redirections.mts'
import { isShellAssignment, plainShellAssignment } from './shell-token-utils.mts'

/** What a recognized wrapper chain before a command word changes about how that command runs. */
export type CommandPrefix = {
  /** The effective `env -C` directory of each `env` in the chain, outermost first. */
  chdir: string[]
  /** Assignments and `env -u` unsets the command sees. */
  env: Record<string, string | undefined>
  /** Wrapper basenames, outermost first. */
  wrappers: string[]
}

type WrapperGrammar = {
  arguments: Readonly<Record<string, 'chdir' | 'unset' | 'other'>>
  flags: readonly string[]
}

// Reserved words that may open a simple command without choosing which program it runs.
const SHELL_CONTROL_PREFIXES = new Set([
  '!',
  '{',
  'coproc',
  'do',
  'elif',
  'else',
  'if',
  'then',
  'until',
  'while',
])
// Control prefixes that open a compound command whose first command follows in the same segment.
const COMPOUND_OPENERS = new Set(['{', 'if', 'until', 'while'])

/**
 * The only wrappers the hook reads through, by basename, with each option spelling they accept.
 * An `arguments` option takes one argument, attached (`-C/tmp`, `--chdir=/tmp`) or the next word.
 * Any other option (`env -S`, a flag cluster) and every other wrapper (`timeout`, `sudo`, `xargs`)
 * leaves the command word unread.
 */
const WRAPPERS: ReadonlyMap<string, WrapperGrammar> = new Map<string, WrapperGrammar>([
  ['builtin', { arguments: {}, flags: [] }],
  ['command', { arguments: {}, flags: ['-p'] }],
  [
    'env',
    {
      arguments: { '--chdir': 'chdir', '--unset': 'unset', '-C': 'chdir', '-u': 'unset' },
      flags: ['-', '-i', '--ignore-environment'],
    },
  ],
  ['exec', { arguments: { '-a': 'other' }, flags: ['-c', '-l'] }],
  ['nohup', { arguments: {}, flags: [] }],
  ['time', { arguments: {}, flags: ['-p'] }],
])

/**
 * Parses the words between a command segment's start and a command word. Returns null when they
 * are not a recognized wrapper chain, i.e. the command word is an argument rather than the
 * program the shell runs. Wrappers chain in any order (`nohup env -C /tmp gh`) and match by
 * basename (`/usr/bin/env`).
 */
export function parseCommandPrefix(prefixWords: readonly string[]): CommandPrefix | null {
  const words = withoutRedirections(prefixWords)
  if (words === null) return null
  const read = readCommandPrefix(words)
  return read?.commandIndex === words.length ? read.prefix : null
}

/**
 * Reads the wrapper chain that opens a simple command's words (redirections already removed) and
 * finds the command word it runs. Returns null when a wrapper's options are unrecognized or only
 * describe the command (`command -v gh`).
 */
export function readCommandPrefix(
  words: readonly string[],
): { commandIndex: number; prefix: CommandPrefix } | null {
  const prefix: CommandPrefix = { chdir: [], env: {}, wrappers: [] }
  let controlAllowed = true
  let cursor = 0
  while (cursor < words.length) {
    const word = words[cursor]!
    if (isShellAssignment(word)) {
      const assignment = plainShellAssignment(word)
      if (assignment !== null) prefix.env[assignment.name] = assignment.value
      cursor += 1
      continue
    }
    // `function NAME` and bash's `coproc NAME` before a compound command (`coproc m { gh …; }`).
    if (
      controlAllowed &&
      (word === 'function' || (word === 'coproc' && COMPOUND_OPENERS.has(words[cursor + 2]!))) &&
      cursor + 1 < words.length
    ) {
      cursor += 2
      continue
    }
    if (controlAllowed && SHELL_CONTROL_PREFIXES.has(word)) {
      cursor += 1
      continue
    }
    const name = word.slice(word.lastIndexOf('/') + 1)
    const grammar = WRAPPERS.get(name)
    if (grammar === undefined) return { commandIndex: cursor, prefix }
    cursor = readWrapperOptions(words, cursor + 1, grammar, prefix)
    if (cursor < 0) return null
    prefix.wrappers.push(name)
    // The `time` keyword times a whole pipeline, so `time ! gh` is still a command.
    controlAllowed = name === 'time'
  }

  return { commandIndex: words.length, prefix }
}

// The shell applies redirections itself and drops each operator and its target from the argv the
// command (or wrapper) receives, wherever they appear: `2>/dev/null env -C /tmp gh` runs env with
// `-C /tmp gh`. A trailing operator's target is the command word, so that word is not a command.
export function withoutRedirections(words: readonly string[]): string[] | null {
  const argv: string[] = []
  for (let index = 0; index < words.length; index += 1) {
    if (!isShellRedirectionOperatorToken(words[index]!)) {
      argv.push(words[index]!)
    } else if (index + 1 === words.length) {
      return null
    } else {
      index += 1
    }
  }
  return argv
}

// Applies one wrapper's options to `prefix` and returns the index after them (right after `--` or
// at the first operand), or -1 for an option outside the grammar. GNU and BSD env keep only the
// last -C, relative to the directory env started in.
function readWrapperOptions(
  words: readonly string[],
  start: number,
  grammar: WrapperGrammar,
  prefix: CommandPrefix,
): number {
  let chdir: string | undefined
  let cursor = start
  while (words[cursor]?.startsWith('-')) {
    const word = words[cursor++]!
    if (word === '--') break
    if (grammar.flags.includes(word)) continue
    const spelling = Object.keys(grammar.arguments).find((option) => takesOption(word, option))
    const attached = spelling === undefined ? '' : word.slice(spelling.length).replace(/^=/, '')
    const value = attached || words[cursor++]
    if (spelling === undefined || value === undefined) return -1
    if (grammar.arguments[spelling] === 'unset') prefix.env[value] = undefined
    if (grammar.arguments[spelling] === 'chdir') chdir = value
  }
  if (chdir !== undefined) prefix.chdir.push(chdir)
  return cursor
}

// A short option takes its argument attached (`-C/tmp`); a long one only after `=` (`--chdir=/tmp`),
// so `--chdirx` is an unknown option, not `--chdir x`.
function takesOption(word: string, option: string): boolean {
  if (!option.startsWith('--')) return word.startsWith(option)
  return word === option || word.startsWith(`${option}=`)
}
