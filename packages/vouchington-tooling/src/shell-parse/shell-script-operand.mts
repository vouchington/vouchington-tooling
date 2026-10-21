import { readAnsiCString } from './ansi-c-string.mts'

// Every shell that reads a script from stdin or `-c`. `busybox` and `toybox` run `sh` / `ash` as an
// applet, so `segmentMayRunStdin` fails closed on them rather than parsing the applet name.
const SHELLS = new Set(['ash', 'bash', 'csh', 'dash', 'fish', 'ksh', 'mksh', 'sh', 'tcsh', 'zsh'])
// Long options that take the next word: bash `--rcfile FILE` / `--init-file FILE`, zsh
// `--emulate NAME`. Listing an extra name only makes a malformed invocation look scriptless.
const LONG_OPTIONS_WITH_ARGUMENT = new Set(['emulate', 'init-file', 'rcfile'])
const SHELL_WORD = /(?:^|[\s;&|()])(?:\S*\/)?(?:ash|bash|csh|dash|fish|ksh|mksh|sh|tcsh|zsh)(?=\s)/g
const NEXT_WORD = /\s*(\S+)/y
// A backslash is literal inside single quotes. Inside double quotes it escapes one character, and
// the two branches start with different characters so a run of backslashes has one reading.
const SINGLE_QUOTED_SCRIPT = /'([^']*)'/y
const DOUBLE_QUOTED_SCRIPT = /"((?:\\[\s\S]|[^"\\])*)"/y

type ShellOption = { argumentWords: number; runsScript: boolean }

/**
 * How bash, sh, and zsh read one word before their first operand. `--` and `-` end the options.
 * Each `o` / `O` letter in a `-` or `+` cluster consumes the next word (`-euo pipefail`,
 * `+O extglob`), and a `c` letter in a `-` cluster makes the first operand the script.
 */
function readShellOption(word: string): ShellOption | 'end' | 'operand' {
  if (word === '--' || word === '-') return 'end'
  if (/^[-+][A-Za-z]+$/.test(word)) {
    return {
      argumentWords: word.replace(/[^oO]/g, '').length,
      runsScript: word.startsWith('-') && word.includes('c'),
    }
  }
  if (/^--[A-Za-z]/.test(word)) {
    return {
      argumentWords: LONG_OPTIONS_WITH_ARGUMENT.has(word.slice(2)) ? 1 : 0,
      runsScript: false,
    }
  }
  return 'operand'
}

/** Whether a command word runs bash, sh, or zsh, by any path. */
export function isShellWord(word: string): boolean {
  return SHELLS.has(word.slice(word.lastIndexOf('/') + 1))
}

/** The index of the script a `bash` / `sh` / `zsh -c` word at `index` runs, if it runs one. */
export function shellScriptOperandIndex(
  words: readonly string[],
  index: number,
): number | undefined {
  if (!isShellWord(words[index]!)) return undefined
  let runsScript = false
  let cursor = index + 1
  while (cursor < words.length) {
    const option = readShellOption(words[cursor]!)
    if (option === 'operand') break
    cursor += 1
    if (option === 'end') break
    runsScript ||= option.runsScript
    cursor += option.argumentWords
  }
  return runsScript && cursor < words.length ? cursor : undefined
}

export type ShellScriptArgument = { script: string; shellIndex: number }

/**
 * The quoted or ANSI-C quoted scripts that `bash` / `sh` / `zsh -c` run in raw command text, each
 * with the index where its shell word's match starts.
 */
export function findShellScriptArguments(command: string): ShellScriptArgument[] {
  const scripts: ShellScriptArgument[] = []
  for (const match of command.matchAll(SHELL_WORD)) {
    const start = scriptStart(command, match.index + match[0].length)
    const script = start === undefined ? undefined : readQuotedScript(command, start)
    if (script !== undefined) scripts.push({ script, shellIndex: match.index })
  }
  return scripts
}

function scriptStart(command: string, position: number): number | undefined {
  let runsScript = false
  let optionsEnded = false
  let pendingArguments = 0
  NEXT_WORD.lastIndex = position
  for (let match = NEXT_WORD.exec(command); match !== null; match = NEXT_WORD.exec(command)) {
    if (pendingArguments > 0) {
      pendingArguments -= 1
      continue
    }
    const option = optionsEnded ? 'operand' : readShellOption(match[1]!)
    if (option === 'operand') return runsScript ? NEXT_WORD.lastIndex - match[1]!.length : undefined
    if (option === 'end') {
      optionsEnded = true
      continue
    }
    runsScript ||= option.runsScript
    pendingArguments = option.argumentWords
  }
  return undefined
}

function readQuotedScript(command: string, start: number): string | undefined {
  if (command.startsWith("$'", start)) return readAnsiCString(command, start + 2)?.value
  if (command[start] === "'") {
    SINGLE_QUOTED_SCRIPT.lastIndex = start
    return SINGLE_QUOTED_SCRIPT.exec(command)?.[1]
  }
  DOUBLE_QUOTED_SCRIPT.lastIndex = start
  return DOUBLE_QUOTED_SCRIPT.exec(command)?.[1]?.replace(/\\([$`"\\\n])/g, '$1')
}
