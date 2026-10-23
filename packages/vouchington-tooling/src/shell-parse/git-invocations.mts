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

type ExtraWrapper = { duration?: true; values: readonly string[] }

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
const FLAG_OPTIONS = new Set([
  '-h',
  '-p',
  '-P',
  '-v',
  '--bare',
  '--exec-path',
  '--glob-pathspecs',
  '--help',
  '--html-path',
  '--icase-pathspecs',
  '--info-path',
  '--literal-pathspecs',
  '--man-path',
  '--no-advice',
  '--no-lazy-fetch',
  '--no-optional-locks',
  '--no-pager',
  '--no-replace-objects',
  '--noglob-pathspecs',
  '--paginate',
  '--version',
])
const ATTACHED_OPTION =
  /^--(?:git-dir|work-tree|namespace|exec-path|config-env|super-prefix|attr-source|list-cmds)=/
const CONFIG_ENV_PREFIX = '--config-env='

// Wrappers `readCommandPrefix` does not read through, with the options that take a separate value.
const EXTRA_WRAPPERS: ReadonlyMap<string, ExtraWrapper> = new Map([
  ['doas', { values: ['-u', '-C'] }],
  ['ionice', { values: ['-c', '-n', '-p', '-P', '-u'] }],
  ['nice', { values: ['-n'] }],
  ['setsid', { values: [] }],
  ['stdbuf', { values: ['-i', '-o', '-e'] }],
  ['sudo', { values: ['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U', '-r', '-t'] }],
  ['timeout', { duration: true, values: ['-s', '-k'] }],
  ['xargs', { values: ['-I', '-n', '-P', '-L', '-s', '-E', '-d', '-a'] }],
])
const DURATION = /^\d+(?:\.\d+)?[smhd]?$/

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

function segmentsOf(command: string): string[][] {
  const segments: string[][] = [[]]
  for (const word of tokenizeShellWordsDetailed(command, {
    markOperators: true,
    splitRedirections: true,
  })) {
    if (word.operator === true) segments.push([])
    else segments.at(-1)!.push(word.value)
  }
  return segments
}

function basename(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1)
}

/** The words from the command word on, or null when the segment runs nothing readable. */
function commandWords(segment: string[]): string[] | null {
  let words = withoutRedirections(segment)
  while (words !== null) {
    const read = readCommandPrefix(words)
    if (read === null || read.commandIndex >= words.length) return null
    words = words.slice(read.commandIndex)
    const wrapper = EXTRA_WRAPPERS.get(basename(words[0]!))
    if (wrapper === undefined) return words
    words = skipWrapper(words, wrapper)
  }
  return null
}

function skipWrapper(words: string[], wrapper: ExtraWrapper): string[] {
  let cursor = 1
  while (words[cursor]?.startsWith('-') === true) {
    const word = words[cursor]!
    cursor += 1
    if (word === '--') break
    if (wrapper.values.includes(word)) cursor += 1
  }
  if (wrapper.duration === true && DURATION.test(words[cursor] ?? '')) cursor += 1
  return words.slice(cursor)
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
