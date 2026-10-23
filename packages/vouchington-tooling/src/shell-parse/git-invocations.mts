import { EXTRA_WRAPPERS, skipWrapper } from './git-wrapper-options.mts'
import { stripNonShellHeredocBodies } from './shell-heredoc.mts'
import { readCommandPrefix, withoutRedirections } from './shell-command-wrappers.mts'
import { tokenizeShellWordsDetailed } from './shell-tokenizer.mts'

/** One `-c key=value` (or `--config-env=key=ENVVAR`, whose value is the variable name). */
export type GitConfigOverride = { key: string; value: string }

export type GitInvocation = {
  /** Subcommand arguments, unquoted, up to the end of the command segment. */
  args: string[]
  /** `-c key=value` pairs in order, with each key as written. */
  configOverrides: GitConfigOverride[]
  /** Every global option word skipped to reach the subcommand, as written (`['-C', '/x']`). */
  globalOptions: string[]
  /** The subcommand word, or undefined for a bare `git` or `git --version`. */
  subcommand: string | undefined
}

const VALUE_OPTIONS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
  '--super-prefix',
  '--attr-source',
])
// These print and exit: any later word is not a subcommand.
const TERMINAL_OPTIONS = new Set([
  '-h',
  '-v',
  '--exec-path',
  '--help',
  '--html-path',
  '--info-path',
  '--man-path',
  '--version',
])
const FLAG_OPTIONS = new Set([
  '-p',
  '-P',
  '--bare',
  '--glob-pathspecs',
  '--icase-pathspecs',
  '--literal-pathspecs',
  '--no-advice',
  '--no-lazy-fetch',
  '--no-literal-pathspecs',
  '--no-optional-locks',
  '--no-pager',
  '--no-replace-objects',
  '--noglob-pathspecs',
  '--paginate',
])
const ATTACHED_OPTION =
  /^--(?:git-dir|work-tree|namespace|exec-path|config-env|super-prefix|attr-source|list-cmds)=/
const CONFIG_ENV_PREFIX = '--config-env='

/**
 * Each `git` the shell would run in command position: after a separator, env assignments, or a
 * wrapper (`env`, `sudo`, `xargs`, `timeout`, `nice`, ...). A `git` word in argument position
 * (`printf %s git`) is not an invocation. Global options are skipped to reach the subcommand and
 * `-c` pairs are collected. `$(...)` text and `bash -c` scripts are not read: feed those to
 * `extractShellCommandSubstitutions` / `extractShellCommandArguments` and call this on each.
 */
export function gitInvocations(command: string): GitInvocation[] {
  const invocations: GitInvocation[] = []
  for (const segment of segmentsOf(command)) {
    const words = commandWords(segment)
    if (words !== null && basename(words[0]!) === 'git') invocations.push(readInvocation(words))
  }
  return invocations
}

/** True when the invocation sets `key` with `-c`. Keys compare case-insensitively. */
export function overridesConfig(invocation: GitInvocation, key: string): boolean {
  const wanted = key.toLowerCase()
  return invocation.configOverrides.some((override) => override.key.toLowerCase() === wanted)
}

// Heredoc bodies that are data are dropped. A `$(` opens a substitution, and `name=(` an array literal;: its body is skipped (it
// belongs to `extractShellCommandSubstitutions`) so the outer command keeps its later arguments.
function segmentsOf(command: string): string[][] {
  const segments: string[][] = [[]]
  let depth = 0
  const words = tokenizeShellWordsDetailed(stripNonShellHeredocBodies(command).textWithoutBodies, {
    markOperators: true,
    splitRedirections: true,
  })
  for (const word of words) {
    const current = segments.at(-1)!
    if (
      depth > 0 ||
      (word.operator === true && word.value === '(' && /[$=]$/.test(current.at(-1) ?? ''))
    ) {
      if (word.operator === true) depth += word.value === '(' ? 1 : word.value === ')' ? -1 : 0
    } else if (word.operator === true) {
      segments.push([])
    } else {
      current.push(word.value)
    }
  }
  return segments
}

function basename(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1)
}

/** The words from the command word on, or null when the segment runs nothing readable. */
function commandWords(segment: string[]): string[] | null {
  // A quoted `'>'` argument is indistinguishable from a redirection here; keep the words then.
  let words = withoutRedirections(segment) ?? segment
  for (;;) {
    const read = readCommandPrefix(words)
    if (read === null || read.commandIndex >= words.length) return null
    words = words.slice(read.commandIndex)
    const wrapper = EXTRA_WRAPPERS.get(basename(words[0]!))
    if (wrapper === undefined) return words
    words = skipWrapper(words, wrapper)
  }
}

function readInvocation(words: string[]): GitInvocation {
  const globalOptions: string[] = []
  const configOverrides: GitConfigOverride[] = []
  let cursor = 1
  while (cursor < words.length) {
    const word = words[cursor]!
    if (VALUE_OPTIONS.has(word)) {
      const value = words[cursor + 1]
      if (value === undefined) break
      globalOptions.push(word, value)
      if (word === '-c' || word === '--config-env') configOverrides.push(splitOverride(value))
      cursor += 2
    } else if (TERMINAL_OPTIONS.has(word)) {
      globalOptions.push(word)
      return { args: [], configOverrides, globalOptions, subcommand: undefined }
    } else if (FLAG_OPTIONS.has(word) || ATTACHED_OPTION.test(word)) {
      globalOptions.push(word)
      if (word.startsWith(CONFIG_ENV_PREFIX)) {
        configOverrides.push(splitOverride(word.slice(CONFIG_ENV_PREFIX.length)))
      }
      cursor += 1
    } else {
      break
    }
  }
  return {
    args: words.slice(cursor + 1),
    configOverrides,
    globalOptions,
    subcommand: words[cursor],
  }
}

function splitOverride(pair: string): GitConfigOverride {
  const equals = pair.indexOf('=')
  return equals < 0
    ? { key: pair, value: '' }
    : { key: pair.slice(0, equals), value: pair.slice(equals + 1) }
}
