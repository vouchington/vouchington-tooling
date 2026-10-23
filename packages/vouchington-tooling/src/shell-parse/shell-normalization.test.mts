import { describe, expect, it } from 'vitest'

import { commandsToInspectForGitPolicy } from './shell-commands.mts'
import { stripNonShellHeredocBodies } from './shell-heredoc.mts'
import { tokenizeShellWords } from './shell-tokenizer.mts'

const PUSH = 'git push --force'

describe('line continuation before a heredoc shell', () => {
  it('extracts the same shell body as the one-line form', () => {
    const oneLine = stripNonShellHeredocBodies(`bash -s <<'EOF'\n${PUSH}\nEOF`)
    const continued = stripNonShellHeredocBodies(`bash \\\n-s <<'EOF'\n${PUSH}\nEOF`)
    expect(oneLine.shellBodies).toEqual([PUSH])
    expect(continued.shellBodies).toEqual([PUSH])
  })

  it('inspects the heredoc body for git policy', () => {
    const commands = commandsToInspectForGitPolicy(`bash \\\n-s <<'EOF'\n${PUSH}\nEOF`)
    expect(commands.some((command) => command.includes(PUSH))).toBe(true)
  })

  it('still sees a shell after a quote opened on an earlier line', () => {
    const command = `printf '%s\n' 'a\nb' \\\n; bash <<'EOF'\n${PUSH}\nEOF`
    expect(stripNonShellHeredocBodies(command).shellBodies).toEqual([PUSH])
  })
})

describe('quoted git -c values', () => {
  it.each([
    [`git -c "core.hooksPath=/tmp/hooks" push --force`],
    [`git -c 'core.hooksPath=/tmp/hooks' push --force`],
  ])('tokenizes %s without quotes', (command) => {
    expect(tokenizeShellWords(command)).toEqual([
      'git',
      '-c',
      'core.hooksPath=/tmp/hooks',
      'push',
      '--force',
    ])
  })

  it('unquotes a commit --amend argv too', () => {
    expect(tokenizeShellWords(`git -c 'core.hooksPath=/tmp/hooks' commit --amend`)).toEqual([
      'git',
      '-c',
      'core.hooksPath=/tmp/hooks',
      'commit',
      '--amend',
    ])
  })

  it('collapses a quoted non-hook -c so the subcommand stays recoverable', () => {
    const views = commandsToInspectForGitPolicy(`git -c "user.name=x" push --force`)
    expect(views.some((view) => /\bgit\s+push\s+--force/.test(view))).toBe(true)
  })

  it('still blanks quoted text such as a commit message', () => {
    const views = commandsToInspectForGitPolicy(`git commit -m "avoid git push --force"`)
    expect(views.some((view) => view.includes('--force'))).toBe(false)
  })
})
