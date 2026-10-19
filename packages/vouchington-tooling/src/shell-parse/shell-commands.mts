import { stripNonShellHeredocBodies } from './shell-heredoc.mts'
import { findShellScriptArguments, shellScriptOperandIndex } from './shell-script-operand.mts'
import { stripUnquotedShellComments, tokenizeShellWords } from './shell-tokenizer.mts'

const GIT_GLOBAL_OPTIONS_RE = new RegExp(
  String.raw`\bgit(?:\s+(?:` +
    String.raw`-C\s+(?:"[^"]*"|'[^']*'|\S+)|` +
    String.raw`-c\s+(?!["']?[Cc][Oo][Rr][Ee]\.[Hh][Oo][Oo][Kk][Ss][Pp][Aa][Tt][Hh]\b)(?:"[^"]*"|'[^']*'|[^\s=]+(?:=(?:"[^"]*"|'[^']*'|\S+))?)|` +
    String.raw`--(?:git-dir|work-tree|namespace|exec-path)=[^\s]+|` +
    String.raw`--(?:no-pager|paginate|bare|no-replace-objects|version|help|html-path|man-path|info-path)|` +
    String.raw`-[vhpP]` +
    String.raw`))+`,
  'g',
)

/** Collapse `git -C <path>` / other globals so banned-subcommand regexes still match. */
export function stripGitGlobalOptionsForPolicy(command: string): string {
  return command.replace(GIT_GLOBAL_OPTIONS_RE, 'git')
}

/**
 * The scripts the git, hook-bypass, and dev-server policies read: the command text, each heredoc
 * body a shell may read as its script, and each substitution an unquoted-delimiter body runs, each
 * with the `bash -c` scripts nested in it. Any other heredoc body is data (a `git commit -F -`
 * message).
 */
export function commandsToInspectForGitPolicy(command: string): string[] {
  return commandsToInspectPreservingQuotes(command).map(stripQuotedShellText)
}

/** Same command list as the regex scan, with quoted refs still readable by the tokenizer. */
export function commandsToInspectPreservingQuotes(command: string): string[] {
  const { bodySubstitutions, shellBodies, textWithoutBodies } = stripNonShellHeredocBodies(command)
  return [textWithoutBodies, ...shellBodies, ...bodySubstitutions].flatMap((script) => {
    const normalizedScript = stripGitGlobalOptionsForPolicy(script.replace(/\\\n/g, ' '))
    return [
      normalizedScript,
      ...extractShellCommandArguments(normalizedScript).map(
        ({ command: shellCommand, inheritsEditor }) =>
          `${inheritsEditor ? 'export GIT_EDITOR=true; ' : ''}${stripGitGlobalOptionsForPolicy(shellCommand)}`,
      ),
    ]
  })
}

export type ShellCommandArgument = {
  command: string
  inheritsEditor: boolean
}

export function extractShellCommandArguments(command: string): ShellCommandArgument[] {
  const commandWithoutComments = stripUnquotedShellComments(command)
  const quotedScripts = findShellScriptArguments(commandWithoutComments).map(
    ({ script, shellIndex }) => ({
      command: script,
      inheritsEditor: shellCommandInheritsEditor(commandWithoutComments, shellIndex),
    }),
  )
  // The quoted scan also reads a `bash -c '…'` nested inside another command's argument. A script
  // built from several quoted pieces or escapes (`bash -c gh\ pr\ merge`, `"gh pr "merge`) is one
  // shell word only the tokenizer reads, and it never inherits an exported editor.
  const seen = new Set(quotedScripts.map((script) => script.command))
  const words = tokenizeShellWords(commandWithoutComments, { splitRedirections: true })
  const wordScripts = words.flatMap((_word, index) => {
    const operand = shellScriptOperandIndex(words, index)
    if (operand === undefined || seen.has(words[operand]!)) return []
    seen.add(words[operand]!)
    return [{ command: words[operand]!, inheritsEditor: false }]
  })
  return [...quotedScripts, ...wordScripts]
}

export function shellCommandInheritsEditor(command: string, shellCommandIndex: number): boolean {
  const segments = command
    .slice(0, shellCommandIndex)
    .split(/[;&|]/)
    .flatMap((segment) => (segment.trim() ? [segment.trim()] : []))

  let exportedEditor = false
  for (const segment of segments) {
    if (/^unset\s+GIT_EDITOR\b/.test(segment)) {
      exportedEditor = false
      continue
    }

    if (/^export\s+GIT_EDITOR\s*=\s*(?:"true"|'true'|true)$/.test(segment)) {
      exportedEditor = true
      continue
    }

    if (/^export\s+GIT_EDITOR\s*=/.test(segment)) {
      exportedEditor = false
    }
  }

  const sameCommandPrefix = segments.at(-1) ?? ''
  return exportedEditor || envPrefixSetsEditor(sameCommandPrefix)
}

export function isInteractiveRebaseContinue(command: string): boolean {
  let exportedEditor = false
  for (const rawSegment of command.split(/&&|\|\||[;|]/)) {
    const segment = rawSegment.trim()
    if (segment === '') {
      continue
    }

    if (/^unset\s+GIT_EDITOR\b/.test(segment)) {
      exportedEditor = false
      continue
    }

    if (/^export\s+GIT_EDITOR\s*=\s*true\b/.test(segment)) {
      exportedEditor = true
      continue
    }

    if (/^export\s+GIT_EDITOR\s*=/.test(segment)) {
      exportedEditor = false
      continue
    }

    const rebaseMatch = /\bgit\s+rebase\b[^\n;&|()]*--continue\b/.exec(segment)
    if (rebaseMatch === null) continue
    const envPrefix = segment.slice(0, rebaseMatch.index).trim()

    if (rebaseMatch.index === 0 && exportedEditor) {
      continue
    }

    if (envPrefixSetsEditor(envPrefix)) {
      continue
    }

    return true
  }

  return false
}

export function envPrefixSetsEditor(prefix: string): boolean {
  const tokens = prefix
    .replace(/^env\s+/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  return (
    tokens.length > 0 &&
    tokens.every((token) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) &&
    tokens.some((token) => /^GIT_EDITOR=(?:"true"|'true'|true)$/.test(token))
  )
}

export function stripQuotedShellText(command: string): string {
  const commandWithSafeEditor = command.replace(
    /\bGIT_EDITOR\s*=\s*(["'])true\1/g,
    'GIT_EDITOR=true',
  )
  let result = ''
  let quote: "'" | '"' | null = null
  let escaping = false

  for (const char of commandWithSafeEditor) {
    if (escaping) {
      result += quote === null ? char : ' '
      escaping = false
      continue
    }

    if (char === '\\') {
      result += quote === null ? char : ' '
      escaping = true
      continue
    }

    if (quote !== null) {
      if (char === quote) {
        quote = null
      }
      result += ' '
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      result += ' '
      continue
    }

    result += char
  }

  return result
}
