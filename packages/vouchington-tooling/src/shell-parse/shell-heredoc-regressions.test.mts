import { describe, expect, it } from 'vitest'

import { stripNonShellHeredocBodies } from './shell-heredoc.mts'
import { commandsToInspectForGitPolicy } from './shell-commands.mts'
import { heredocSpecsFromLine } from './shell-heredoc-parser.mts'
import { findShellScriptArguments, isShellWord } from './shell-script-operand.mts'

const PUSH = 'git push --force'

describe('quote state across $( ) inside double quotes', () => {
  it('restores the double quote at the matching paren', () => {
    const command = `echo "$(true) <<EOF x"\n${PUSH}\nEOF`
    expect(heredocSpecsFromLine('echo "$(true) <<EOF x"')).toEqual([])
    expect(stripNonShellHeredocBodies(command).textWithoutBodies).toContain(PUSH)
  })

  it('handles nested substitutions and quotes', () => {
    const nested = `echo "$( echo "$(true) <<EOF" ) <<EOF"\n${PUSH}\nEOF`
    expect(stripNonShellHeredocBodies(nested).textWithoutBodies).toContain(PUSH)
    const arithmetic = `echo "$((1 + (2))) <<EOF"\n${PUSH}\nEOF`
    expect(stripNonShellHeredocBodies(arithmetic).textWithoutBodies).toContain(PUSH)
    const subshell = `echo "$( (true) ) <<EOF"\n${PUSH}\nEOF`
    expect(stripNonShellHeredocBodies(subshell).textWithoutBodies).toContain(PUSH)
  })

  it('still finds a heredoc after an unquoted substitution closes', () => {
    expect(heredocSpecsFromLine('cat $(true) <<EOF')).toEqual([
      { delimiter: 'EOF', expandsSubstitutions: true, stripLeadingTabs: false },
    ])
    const command = `echo "$(true)"; cat <<EOF\nnot a command\nEOF`
    expect(stripNonShellHeredocBodies(command).textWithoutBodies).not.toContain('not a command')
  })

  it('carries an open substitution across lines', () => {
    const command = `echo "$(true\n) <<EOF"\n${PUSH}`
    expect(stripNonShellHeredocBodies(command).textWithoutBodies).toContain(PUSH)
  })
})

describe('shells other than bash, sh, and zsh', () => {
  it.each(['dash', 'ksh', 'mksh', 'ash', 'fish', 'csh', 'tcsh', '/bin/dash'])(
    'keeps a %s heredoc body as a script',
    (shell) => {
      const scan = stripNonShellHeredocBodies(`${shell} <<EOF\n${PUSH}\nEOF`)
      expect(scan.shellBodies).toEqual([PUSH])
    },
  )

  it.each(['busybox sh', 'toybox sh', 'sudo dash', 'env ksh', 'nice -n 5 dash'])(
    'fails closed on %s',
    (prefix) => {
      expect(stripNonShellHeredocBodies(`${prefix} <<EOF\n${PUSH}\nEOF`).shellBodies).toEqual([
        PUSH,
      ])
    },
  )

  it('inspects a dash heredoc body and a -c script', () => {
    expect(commandsToInspectForGitPolicy(`dash <<EOF\n${PUSH}\nEOF`)).toContain(PUSH)
    expect(findShellScriptArguments(`ksh -c '${PUSH}'`)).toEqual([{ script: PUSH, shellIndex: 0 }])
    expect(isShellWord('/usr/bin/mksh')).toBe(true)
    expect(isShellWord('cat')).toBe(false)
  })

  it('still treats a cat heredoc as data', () => {
    expect(stripNonShellHeredocBodies(`cat <<EOF\n${PUSH}\nEOF`).shellBodies).toEqual([])
  })
})
