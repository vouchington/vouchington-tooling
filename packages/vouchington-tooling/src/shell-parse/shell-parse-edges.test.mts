import { describe, expect, it } from 'vitest'

import {
  decodeAnsiCStringEscape,
  decodeNumericAnsiEscape,
  readAnsiCString,
} from './ansi-c-string.mts'
import {
  extractShellCommandSubstitutions,
  readBacktickSubstitution,
  readParenthesizedSubstitution,
} from './shell-command-substitutions.mts'
import {
  commandsToInspectForGitPolicy,
  commandsToInspectPreservingQuotes,
  envPrefixSetsEditor,
  extractShellCommandArguments,
  isInteractiveRebaseContinue,
  shellCommandInheritsEditor,
  stripGitGlobalOptionsForPolicy,
  stripQuotedShellText,
} from './shell-commands.mts'
import {
  parseCommandPrefix,
  readCommandPrefix,
  withoutRedirections,
} from './shell-command-wrappers.mts'
import { readHeredocDelimiter } from './shell-heredoc-delimiter.mts'
import { heredocSpecsFromLine } from './shell-heredoc-parser.mts'
import { stripNonShellHeredocBodies } from './shell-heredoc.mts'
import { findShellScriptArguments, shellScriptOperandIndex } from './shell-script-operand.mts'
import { shellReadsStdinAt } from './shell-stdin-script.mts'
import { plainShellAssignment } from './shell-token-utils.mts'
import { stripUnquotedShellComments, tokenizeShellWords } from './shell-tokenizer.mts'

describe('shell parser edges', () => {
  it('covers ANSI-C letters, numbers, and a trailing backslash', () => {
    expect(decodeAnsiCStringEscape('\\b', 1).value).toBe('\b')
    expect(decodeAnsiCStringEscape('\\f', 1).value).toBe('\f')
    expect(decodeAnsiCStringEscape('\\n', 1).value).toBe('\n')
    expect(decodeAnsiCStringEscape('\\r', 1).value).toBe('\r')
    expect(decodeAnsiCStringEscape('\\t', 1).value).toBe('\t')
    expect(decodeAnsiCStringEscape('\\v', 1).value).toBe('\v')
    expect(decodeAnsiCStringEscape('\\\\', 1).value).toBe('\\')
    expect(decodeAnsiCStringEscape('\\"', 1).value).toBe('"')
    expect(decodeAnsiCStringEscape('\\?', 1).value).toBe('?')
    expect(decodeAnsiCStringEscape('\\', 1).value).toBeUndefined()
    expect(readAnsiCString('\\', 0)).toBeNull()
    expect(decodeNumericAnsiEscape('x41', 1, 2, 16, '\\x').value).toBe('A')
    expect(decodeNumericAnsiEscape('u0042', 1, 4, 16, '\\u').value).toBe('B')
    expect(decodeNumericAnsiEscape('101', 0, 3, 8, '\\').value).toBe('A')
    expect(tokenizeShellWords(`echo $'a\\b'`)).toEqual(['echo', 'a\b'])
    expect(tokenizeShellWords(`echo 'a\\b'`)).toEqual(['echo', 'a\\b'])
    expect(tokenizeShellWords('echo "a\\q"')).toEqual(['echo', 'a\\q'])
  })

  it('reads nested, quoted, escaped, and unclosed substitutions', () => {
    expect(readParenthesizedSubstitution("echo 'x)' )", 0)?.command).toBe("echo 'x)' ")
    expect(readParenthesizedSubstitution('echo (inner))', 0)?.command).toBe('echo (inner)')
    expect(readParenthesizedSubstitution('echo "x)" )', 0)?.command).toBe('echo "x)" ')
    expect(readParenthesizedSubstitution('echo \\))', 0)?.command).toBe('echo \\)')
    expect(readParenthesizedSubstitution('unterminated', 0)).toBeNull()
    expect(readBacktickSubstitution('a\\nb`', 0)?.command).toBe('a\\nb')
    expect(readBacktickSubstitution('a\\$b`', 0)?.command).toBe('a$b')
    expect(readBacktickSubstitution('unterminated', 0)).toBeNull()
    expect(extractShellCommandSubstitutions('echo \\"$(no)" "ok $(yes)"')).toEqual(['no', 'yes'])
    expect(extractShellCommandSubstitutions("echo '\\$(no)'")).toEqual([])
    expect(extractShellCommandSubstitutions('echo $x `unterminated')).toEqual([])
    expect(decodeAnsiCStringEscape('\\e', 1).value).toBe('\u001b')
    expect(decodeAnsiCStringEscape('\\U00000041', 1).value).toBe('A')
    expect(extractShellCommandSubstitutions('echo $(unterminated')).toEqual([])
    expect(readHeredocDelimiter('"E\\nOF"', 0)?.value).toBe('E\\nOF')
    expect(commandsToInspectForGitPolicy("bash -c 'echo hi'")).toContain('echo hi')
    expect(stripQuotedShellText('echo "a\\b"')).toBe('echo      ')
    expect(shellScriptOperandIndex(['bash', '--norc', '-c', 'echo'], 0)).toBe(3)
    expect(shellScriptOperandIndex(['bash', '-c', '--', 'echo'], 0)).toBe(3)
    expect(shellReadsStdinAt(['cat', '<<', 'EOF', '|', '&', 'bash'], 1)).toBe(true)
    expect(shellReadsStdinAt(['cat', '<<', 'EOF', '|'], 1)).toBe(true)
    expect(shellReadsStdinAt(['cat', '<<', 'EOF', '|', 'cat', '|', 'bash'], 1)).toBe(true)
    expect(readHeredocDelimiter('\\EOF', 0)).toMatchObject({
      expandsSubstitutions: false,
      value: 'EOF',
    })
    expect(heredocSpecsFromLine('echo \\ <<EOF')).toEqual([
      { delimiter: 'EOF', expandsSubstitutions: true, stripLeadingTabs: false },
    ])
    expect(heredocSpecsFromLine('"$(cat <<EOF"')).toEqual([])
    expect(stripNonShellHeredocBodies('cat <<EOF\nno close').textWithoutBodies).toBe('cat <<EOF\n')
    expect(stripNonShellHeredocBodies('bash <<-EOF\n\techo tab\n\tEOF').shellBodies[0]).toBe(
      '\techo tab',
    )
    expect(parseCommandPrefix(['git', '>'])).toBeNull()
    expect(readCommandPrefix(['FOO+=1', 'git'])?.commandIndex).toBe(1)
    expect(
      commandsToInspectPreservingQuotes("export GIT_EDITOR=true; bash -c 'echo'").join('\n'),
    ).toContain('GIT_EDITOR=true')
    expect(isInteractiveRebaseContinue('export GIT_EDITOR=other; git rebase --continue')).toBe(true)
    expect(isInteractiveRebaseContinue('echo hi; git rebase --continue')).toBe(true)
    expect(findShellScriptArguments("bash -c -- 'echo hi'")[0]?.script).toBe('echo hi')
    expect(findShellScriptArguments('bash -c')).toEqual([])
    expect(shellReadsStdinAt(['cat', '<<', 'EOF', '|', 'bash'], 1)).toBe(true)
    expect(shellReadsStdinAt(['cat', '<<', '|', '&', 'bash'], 1)).toBe(true)
    expect(shellReadsStdinAt(['cat', '<<', '|'], 1)).toBe(true)
    expect(shellReadsStdinAt(['done', '<<'], 1)).toBe(true)
    expect(shellReadsStdinAt(['env', '-S', 'sh'], 0)).toBe(true)
    expect(shellReadsStdinAt([')', 'bash', '<<'], 2)).toBe(true)
    expect(tokenizeShellWords('echo out>file', { splitRedirections: true })).toContain('>')
    expect(tokenizeShellWords("echo $'unterminated")).toEqual(['echo', '$unterminated'])
    expect(stripUnquotedShellComments("$'unterminated")).toContain("$'")
  })

  it('reads heredoc delimiters, comments, here-strings, and body escapes', () => {
    expect(readHeredocDelimiter('"E\\"OF"', 0)).toMatchObject({
      expandsSubstitutions: false,
      value: 'E"OF',
    })
    expect(readHeredocDelimiter('\\', 0)).toBeNull()
    expect(readHeredocDelimiter("'EOF", 0)).toBeNull()
    expect(readHeredocDelimiter('', 0)).toBeNull()
    expect(heredocSpecsFromLine('echo # <<EOF')).toEqual([])
    expect(heredocSpecsFromLine('cat <<< WORD')).toEqual([])
    expect(heredocSpecsFromLine('cat <<- EOF')).toEqual([
      { delimiter: 'EOF', expandsSubstitutions: true, stripLeadingTabs: true },
    ])
    const scan = stripNonShellHeredocBodies('cat <<EOF\n\\$(skip) $(keep) `tick`\nEOF')
    expect(scan.bodySubstitutions).toEqual(['keep', 'tick'])
    expect(stripNonShellHeredocBodies("bash <<< 'echo hi'").shellBodies).toContain('echo hi')
  })

  it('walks wrapper options, compound commands, and trailing redirections', () => {
    expect(readCommandPrefix(['function', 'name', '{', 'git'])?.commandIndex).toBe(3)
    expect(readCommandPrefix(['coproc', 'name', '{', 'git'])?.commandIndex).toBe(3)
    expect(readCommandPrefix(['if', 'git'])?.commandIndex).toBe(1)
    expect(readCommandPrefix(['time', '!', 'git'])?.commandIndex).toBe(2)
    expect(withoutRedirections(['git', '>'])).toBeNull()
    expect(parseCommandPrefix(['env', '--chdir=/tmp', '--', 'git'])).toBeNull()
    expect(readCommandPrefix(['/usr/bin/env', '-i', 'git'])?.prefix.wrappers).toEqual(['env'])
    expect(readCommandPrefix(['exec', '-a', 'name', 'git'])?.commandIndex).toBe(3)
    expect(readCommandPrefix(['command', '-p', 'git'])?.commandIndex).toBe(2)
    expect(readCommandPrefix(['builtin', 'git'])?.commandIndex).toBe(1)
  })

  it('covers git inspection, editors, and quoted shell scripts', () => {
    expect(stripGitGlobalOptionsForPolicy('git --no-pager -C /tmp status')).toBe('git status')
    expect(stripGitGlobalOptionsForPolicy('git -c core.hooksPath=/tmp status')).toContain(
      'core.hooksPath',
    )
    expect(plainShellAssignment('FOO+=1')).toBeNull()
    expect(plainShellAssignment('FOO[0]=1')).toBeNull()
    expect(
      shellCommandInheritsEditor("unset GIT_EDITOR; export GIT_EDITOR=false; bash -c 'x'", 48),
    ).toBe(false)
    expect(envPrefixSetsEditor('env GIT_EDITOR=true')).toBe(true)
    expect(envPrefixSetsEditor('')).toBe(false)
    expect(isInteractiveRebaseContinue('export GIT_EDITOR=true; git rebase --continue')).toBe(false)
    expect(isInteractiveRebaseContinue('unset GIT_EDITOR; git rebase --continue')).toBe(true)
    expect(isInteractiveRebaseContinue('')).toBe(false)
    expect(extractShellCommandArguments('bash -c echo\\ hi')[0]?.command).toBe('echo hi')
    expect(findShellScriptArguments('bash --rcfile /tmp/rc -c "echo \\"hi\\""')[0]?.script).toBe(
      'echo "hi"',
    )
    expect(shellScriptOperandIndex(['bash', '--rcfile', '/tmp/rc', '-c', 'echo'], 0)).toBe(4)
    expect(shellScriptOperandIndex(['bash', '-euo', 'pipefail', 'script.sh'], 0)).toBeUndefined()
    expect(findShellScriptArguments("bash -c $'echo hi'")[0]?.script).toBe('echo hi')
    const inspected = commandsToInspectPreservingQuotes(
      "bash <<'EOF'\necho $(echo nested)\nEOF\ngit commit -m 'keep'",
    )
    expect(inspected.some((command) => command.includes('nested'))).toBe(true)
    expect(commandsToInspectForGitPolicy("git commit -m 'keep'").join('\n')).not.toContain("'")
    expect(stripQuotedShellText('echo \\"a\\"')).toContain('\\')
  })

  it('decides when a pipeline or compound command may read stdin', () => {
    const pipeline = tokenizeShellWords('cat <<EOF | bash', { splitRedirections: true })
    const operator = pipeline.findIndex((token) => token === '<<')
    expect(shellReadsStdinAt(pipeline, operator)).toBe(true)
    const open = tokenizeShellWords('{ bash; } <<EOF', { splitRedirections: true })
    expect(
      shellReadsStdinAt(
        open,
        open.findIndex((token) => token === '<<'),
      ),
    ).toBe(true)
    const expanded = tokenizeShellWords('$SHELL <<EOF', { splitRedirections: true })
    expect(
      shellReadsStdinAt(
        expanded,
        expanded.findIndex((token) => token === '<<'),
      ),
    ).toBe(true)
    expect(stripUnquotedShellComments("echo $'a#b' # tail")).toContain("$'a#b'")
    expect(tokenizeShellWords('echo >out', { splitRedirections: true })).toContain('>')
  })
})
