import {
  readBacktickSubstitution,
  readParenthesizedSubstitution,
} from './shell-command-substitutions.mts'
import { heredocSpecsFromLine, type HeredocSpec } from './shell-heredoc-parser.mts'
import { newHeredocLineState } from './shell-heredoc-quote-state.mts'
import { redirectionOperatorOf } from './shell-redirections.mts'
import { shellReadsStdinAt } from './shell-stdin-script.mts'
import { tokenizeShellWords } from './shell-tokenizer.mts'

const HEREDOC_OPERATORS = new Set(['<<', '<<-'])

type HeredocScan = {
  /** The command substitutions heredoc bodies with an unquoted delimiter run. */
  bodySubstitutions: string[]
  /** Heredoc bodies and here-strings a shell may read as its script. */
  shellBodies: string[]
  /** The command with every heredoc body line blanked, so no body line reads as a command. */
  textWithoutBodies: string
}

export function stripNonShellHeredocBodies(command: string): HeredocScan {
  const lines = command.split('\n')
  const textLines: string[] = []
  const bodySubstitutions: string[] = []
  const shellBodies: string[] = []

  const carried = newHeredocLineState()
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const specs = heredocSpecsFromLine(line, carried)
    textLines.push(line)
    if (specs.length === 0) {
      continue
    }

    // The hook does not pair each operator with its body, so a line with a shell-read heredoc
    // inspects every body on it.
    const isShellScriptHeredoc = lineFeedsShellHeredoc(logicalLine(lines, index))
    for (const spec of specs) {
      const bodyLines: string[] = []
      index += 1
      while (index < lines.length && heredocLineDelimiter(lines[index]!, spec) !== spec.delimiter) {
        bodyLines.push(lines[index]!)
        textLines.push('')
        index += 1
      }
      if (index < lines.length) {
        textLines.push(lines[index]!)
      }

      if (isShellScriptHeredoc) {
        shellBodies.push(bodyLines.join('\n'))
      }
      if (spec.expandsSubstitutions) {
        bodySubstitutions.push(...heredocBodySubstitutions(bodyLines.join('\n')))
      }
    }
  }

  const textWithoutBodies = textLines.join('\n')
  return {
    bodySubstitutions,
    shellBodies: [...shellBodies, ...shellHereStrings(textWithoutBodies)],
    textWithoutBodies,
  }
}

// `bash <<< 'gh pr merge 1'` and `cat <<< '…' | sh` read the here-string as the script, as they
// would a heredoc body.
function shellHereStrings(command: string): string[] {
  const tokens = tokenizeShellWords(command, { splitRedirections: true })
  return tokens.flatMap((token, index) =>
    redirectionOperatorOf(token) === '<<<' &&
    index + 1 < tokens.length &&
    shellReadsStdinAt(tokens, index)
      ? [tokens[index + 1]!]
      : [],
  )
}

// Quotes and `#` are literal text in a heredoc body; a backslash escapes only `$`, a backtick,
// or another backslash.
function heredocBodySubstitutions(body: string): string[] {
  const substitutions: string[] = []
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (char === '\\') {
      index += 1
      continue
    }
    const substitution =
      char === '$' && body[index + 1] === '('
        ? readParenthesizedSubstitution(body, index + 2)
        : char === '`'
          ? readBacktickSubstitution(body, index + 1)
          : null
    if (substitution !== null) {
      substitutions.push(substitution.command)
      index = substitution.endIndex
    }
  }

  return substitutions
}

// A line ending in an odd run of backslashes continues onto the next, so the command that owns a
// heredoc operator may start on earlier lines (`bash \\\n-s <<'EOF'`).
function logicalLine(lines: string[], index: number): string {
  let start = index
  while (start > 0 && /(?:^|[^\\])(?:\\\\)*\\$/.test(lines[start - 1]!)) start -= 1
  return lines.slice(start, index + 1).join('\n')
}

function heredocLineDelimiter(line: string, spec: HeredocSpec): string {
  return spec.stripLeadingTabs ? line.replace(/^\t+/, '') : line
}

// The tokenizer keeps a heredoc operator inside a double-quoted `"$(… <<'EOF'` in the quoted word,
// so that body stays data (`git commit -m "$(cat <<'EOF'`) even when a shell reads it.
function lineFeedsShellHeredoc(line: string): boolean {
  const tokens = tokenizeShellWords(line, { splitRedirections: true })
  return tokens.some(
    (token, index) =>
      HEREDOC_OPERATORS.has(redirectionOperatorOf(token)) && shellReadsStdinAt(tokens, index),
  )
}
