import { describe, expect, it } from 'vitest'

import { tokenizeShellWords as tokenizeFromIndex } from './index.mts'

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
import { heredocSpecsFromLine } from './shell-heredoc-parser.mts'
import { stripNonShellHeredocBodies } from './shell-heredoc.mts'
import {
  isShellRedirectionOperatorToken,
  redirectionOperatorOf,
  shellRedirectionOperatorAt,
} from './shell-redirections.mts'
import {
  findShellScriptArguments,
  isShellWord,
  shellScriptOperandIndex,
} from './shell-script-operand.mts'
import { shellReadsStdinAt } from './shell-stdin-script.mts'
import {
  commandSegmentStart,
  isShellAssignment,
  isShellCommandSeparator,
  nextShellCommandSeparatorIndex,
  plainShellAssignment,
} from './shell-token-utils.mts'
import {
  stripUnquotedShellComments,
  tokenizeShellWords,
  tokenizeShellWordsDetailed,
} from './shell-tokenizer.mts'

describe('shell tokenizer', () => {
  it('splits words, quotes, escapes, comments, and separators', () => {
    expect(tokenizeFromIndex('echo hi')).toEqual(['echo', 'hi'])
    expect(tokenizeShellWords(`git commit -m 'a b' "c\\"d" $'x\\n' # note`)).toEqual([
      'git',
      'commit',
      '-m',
      'a b',
      'c"d',
      'x\n',
    ])
    expect(tokenizeShellWords('a\\\nb; c && d || e | f\ng')).toEqual([
      'a\nb',
      ';',
      'c',
      '&&',
      'd',
      '||',
      'e',
      '|',
      'f',
      '\n',
      'g',
    ])
    expect(tokenizeShellWordsDetailed('a{b,c} *.txt').map((word) => word.expandable)).toEqual([
      true,
      true,
    ])
    expect(tokenizeShellWords('echo 2>out <in', { splitRedirections: true })).toEqual([
      'echo',
      '2>',
      'out',
      '<',
      'in',
    ])
    expect(stripUnquotedShellComments("echo ' # ' # tail")).toBe("echo ' # ' ")
  })

  it('decodes ANSI-C escapes and leaves an unclosed string unread', () => {
    expect(readAnsiCString(String.raw`a\n\t\x41\u0042\101\' '`, 0)?.value).toBe("a\n\tABA' ")
    expect(readAnsiCString('unterminated', 0)).toBeNull()
    expect(decodeAnsiCStringEscape('\\a', 1).value).toBe('\u0007')
    expect(decodeAnsiCStringEscape('\\E', 1).value).toBe('\u001b')
    expect(decodeAnsiCStringEscape('\\\n', 1).value).toBe('')
    expect(decodeAnsiCStringEscape('\\q', 1).value).toBe('q')
    expect(decodeNumericAnsiEscape('\\x', 2, 2, 16, '\\x').value).toBe('\\x')
    expect(decodeNumericAnsiEscape('\\U110000', 2, 8, 16, '\\U').value).toContain('110000')
  })
})

describe('shell commands', () => {
  it('strips git globals and quoted text without hiding the command', () => {
    expect(stripGitGlobalOptionsForPolicy('git -C /tmp -c core.editor=vi commit')).toBe(
      'git commit',
    )
    expect(stripQuotedShellText(`echo "a b" 'c'`)).toMatch(/^echo {10}$/)
    expect(commandsToInspectPreservingQuotes("git commit -m 'keep'")).toEqual([
      "git commit -m 'keep'",
    ])
    expect(commandsToInspectForGitPolicy("git commit -m 'keep'")[0]).not.toContain('keep')
  })

  it('reads shell scripts, editors, and interactive rebase continues', () => {
    expect(extractShellCommandArguments("bash -c 'echo hi'")).toEqual([
      { command: 'echo hi', inheritsEditor: false },
    ])
    expect(shellCommandInheritsEditor('export GIT_EDITOR=true; bash -c true', 28)).toBe(true)
    expect(envPrefixSetsEditor('GIT_EDITOR=true')).toBe(true)
    expect(envPrefixSetsEditor('EDITOR=true')).toBe(false)
    expect(isInteractiveRebaseContinue('git rebase --continue')).toBe(true)
    expect(isInteractiveRebaseContinue('GIT_EDITOR=true git rebase --continue')).toBe(false)
    expect(findShellScriptArguments("bash -c 'echo hi'")[0]?.script).toBe('echo hi')
    expect(isShellWord('/bin/bash')).toBe(true)
    expect(shellScriptOperandIndex(['bash', '-c', 'echo'], 0)).toBe(2)
  })
})

describe('heredoc and substitutions', () => {
  it('blanks a data heredoc and keeps a shell heredoc body', () => {
    const command = "git commit -F - <<'EOF'\nnot a command\nEOF\nbash <<EOS\necho hi\nEOS"
    const scan = stripNonShellHeredocBodies(command)
    expect(scan.textWithoutBodies).not.toContain('not a command')
    expect(scan.shellBodies.join('\n')).toContain('echo hi')
    expect(heredocSpecsFromLine("cat <<'EOF' <<-TAB")?.length).toBeGreaterThan(0)
  })

  it('reads command substitutions outside single quotes', () => {
    expect(extractShellCommandSubstitutions("echo $(echo a) `echo b` '$(no)'")).toEqual([
      'echo a',
      'echo b',
    ])
    expect(readParenthesizedSubstitution('echo nested)', 0)?.command).toBe('echo nested')
    expect(readBacktickSubstitution('echo b`', 0)?.command).toBe('echo b')
  })
})

describe('wrappers and stdin', () => {
  it('parses an env and nohup wrapper chain', () => {
    expect(
      parseCommandPrefix(['FOO=1', 'env', '-C', '/tmp', '-u', 'FOO', 'nohup', 'env', '-Cc']),
    ).toEqual({
      chdir: ['/tmp', 'c'],
      env: { FOO: undefined },
      wrappers: ['env', 'nohup', 'env'],
    })
    expect(readCommandPrefix(['env', '-S', 'git'])).toBeNull()
    expect(withoutRedirections(['2>', 'out', 'git'])).toEqual(['git'])
  })

  it('detects when a shell may read a heredoc as its script', () => {
    const tokens = tokenizeShellWords('bash <<EOF', { splitRedirections: true })
    const operator = tokens.findIndex((token) => redirectionOperatorOf(token) === '<<')
    expect(shellReadsStdinAt(tokens, operator)).toBe(true)
    expect(isShellRedirectionOperatorToken('>>')).toBe(true)
    expect(shellRedirectionOperatorAt('echo >out', 5)).toBe('>')
    expect(isShellAssignment('FOO=1')).toBe(true)
    expect(plainShellAssignment('FOO=1')).toEqual({ name: 'FOO', value: '1' })
    expect(isShellCommandSeparator('&&')).toBe(true)
    expect(commandSegmentStart(['a', ';', 'b'], 2)).toBe(2)
    expect(nextShellCommandSeparatorIndex(['a', '|', 'b'], 0)).toBe(1)
  })
})
