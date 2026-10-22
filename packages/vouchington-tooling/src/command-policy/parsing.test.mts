import { describe, expect, it } from 'vitest'

import { tokenizeShellWords } from '../shell-parse/index.mts'
import {
  commandCwd,
  commandPrefixAt,
  commandSegmentStart,
  commandsToInspectForGitHubPolicy,
  hasNamedFlag,
  hasNumericPrSelector,
  isGhCommandSeparator,
  lastNamedOption,
  parseGhInvocation,
  parseGhOptions,
  parseGhOrGhStackInvocation,
} from './index.mts'

const words = (text: string) => tokenizeShellWords(text, { splitRedirections: true })

describe('parseGhOptions', () => {
  it('reads long, short, attached, and equals forms', () => {
    const options = parseGhOptions(
      words(
        'create --title T -b B --body-file=f.md -Fg.md --label x -l y --repo o/r -Rp/q --draft -t2 --bogus',
      ),
    )
    expect(options).toEqual({
      body: ['B'],
      bodyFile: ['f.md', 'g.md'],
      draft: true,
      label: ['x', 'y'],
      repo: ['o/r', 'p/q'],
      title: ['T', '2'],
    })
  })

  it('stops at a command separator and ignores a flag with no value', () => {
    expect(parseGhOptions(['--title', '&&', '--body', 'x']).title).toEqual(['&&'])
    expect(parseGhOptions(['--body']).body).toEqual([])
    expect(parseGhOptions(['--draft', ';', '--title', 'x'])).toMatchObject({
      draft: true,
      title: [],
    })
  })

  it.each(['&&', '&', '(', ')', ';', '|', '||', '\n'])('treats %j as a separator', (token) => {
    expect(isGhCommandSeparator(token)).toBe(true)
  })

  it('does not treat words as separators', () => {
    expect(isGhCommandSeparator('gh')).toBe(false)
  })
})

describe('option flag helpers', () => {
  it('returns the last value of a named option', () => {
    expect(lastNamedOption(['--base', 'a', '--base=b'], 'base', 'B')).toBe('b')
    expect(lastNamedOption(['-B', 'a', '-Bc'], 'base', 'B')).toBe('c')
    expect(lastNamedOption(['-fB', 'e'], 'base', 'B')).toBe('e')
    expect(lastNamedOption(['-fBx'], 'base', 'B')).toBe('x')
    expect(lastNamedOption(['-B', '--next'], 'base', 'B')).toBeUndefined()
    expect(lastNamedOption(['-fB', '--next'], 'base', 'B')).toBeUndefined()
    expect(lastNamedOption(['--base'], 'base')).toBeUndefined()
    expect(lastNamedOption(['--base', 'x'], 'base')).toBe('x')
    expect(lastNamedOption(['-f', 'x', '--base=y'], 'base')).toBe('y')
    expect(lastNamedOption(['--other'], 'base', 'B')).toBeUndefined()
    expect(lastNamedOption(['-xyz'], 'base', 'B')).toBeUndefined()
  })

  it('treats a multi-letter short flag as unclustered', () => {
    expect(lastNamedOption(['-ab'], 'base', 'ab')).toBeUndefined()
  })

  it('reads boolean flags with false-like values as off', () => {
    expect(hasNamedFlag(['--auto'], 'auto')).toBe(true)
    expect(hasNamedFlag(['--auto=true'], 'auto')).toBe(true)
    expect(hasNamedFlag(['--auto', '--auto=OFF'], 'auto')).toBe(false)
    expect(hasNamedFlag(['--auto=0', '--auto'], 'auto')).toBe(true)
    expect(hasNamedFlag(['--other'], 'auto')).toBe(false)
  })

  it('finds a numeric selector', () => {
    expect(hasNumericPrSelector(['--squash', '12'])).toBe(true)
    expect(hasNumericPrSelector(['12a', 'x'])).toBe(false)
  })
})

describe('gh invocation parsing', () => {
  it('splits area, action, and arguments, dropping redirections', () => {
    expect(parseGhOrGhStackInvocation(words('gh pr merge 12 > --auto --squash'), 0)).toEqual({
      action: 'merge',
      area: 'pr',
      arguments: ['12', '>', '--auto', '--squash'],
      optionTokenIndexes: [3, 6],
      optionTokens: ['12', '--squash'],
    })
  })

  it('keeps -R/--repo out of the area and action slots', () => {
    const invocation = parseGhInvocation(words('gh -R o/r pr --repo=x view 1'), 0)
    expect(invocation?.area).toBe('pr')
    expect(invocation?.action).toBe('view')
    expect(invocation?.optionTokens).toEqual(['-R', 'o/r', '--repo=x', '1'])
    expect(parseGhInvocation(words('gh -Ro/r pr view'), 0)?.optionTokens).toEqual(['-Ro/r'])
    expect(parseGhInvocation(['gh', '--repo', '&&'], 0)).toBeNull()
  })

  it('maps gh-stack to the stack area and rejects other executables', () => {
    const stack = parseGhOrGhStackInvocation(words('/bin/gh-stack submit --auto'), 0)
    expect(stack?.area).toBe('stack')
    expect(stack?.optionTokens).toEqual(['--auto'])
    expect(parseGhOrGhStackInvocation(words('ls -l'), 0)).toBeNull()
    expect(parseGhOrGhStackInvocation(words('gh pr'), 0)).toBeNull()
  })

  it('stops at a separator', () => {
    expect(parseGhInvocation(words('gh pr view 1 && echo --done'), 0)?.optionTokens).toEqual(['1'])
  })
})

describe('command position', () => {
  it('finds the segment start and wrapper prefix', () => {
    const tokens = words('echo a && env FOO=1 gh pr view')
    expect(commandSegmentStart(tokens, 5)).toBe(3)
    expect(commandPrefixAt(tokens, 5)?.wrappers).toEqual(['env'])
    expect(commandPrefixAt(words('echo gh'), 1)).toBeNull()
  })
})

describe('commandsToInspectForGitHubPolicy', () => {
  it('collects nested scripts, substitutions, and heredoc shell bodies', () => {
    const inspected = commandsToInspectForGitHubPolicy(
      'bash -c "gh pr view 1" && echo $(gh pr list) \\\n && sh <<EOF\ngh pr merge 3\nEOF',
    )
    expect(inspected).toEqual(
      expect.arrayContaining([
        'gh pr view 1',
        'gh pr list',
        expect.stringContaining('gh pr merge 3'),
      ]),
    )
  })

  it('deduplicates identical candidates', () => {
    expect(commandsToInspectForGitHubPolicy('bash -c "bash -c ls"')).toHaveLength(3)
    expect(commandsToInspectForGitHubPolicy('echo $(echo hi) $(echo hi)').length).toBeLessThan(5)
  })
})

describe('commandCwd', () => {
  const cwdOf = (text: string, base = '/base') => {
    const tokens = words(text)
    return commandCwd(tokens, tokens.lastIndexOf('gh'), base)
  }

  it('follows sequential cd builtins', () => {
    expect(cwdOf('gh pr view')).toBe('/base')
    expect(cwdOf('cd sub && gh pr view')).toBe('/base/sub')
    expect(cwdOf('cd /abs; gh pr view')).toBe('/abs')
    expect(cwdOf('cd a && cd ../b && gh pr view')).toBe('/base/b')
    expect(cwdOf('cd -- sub && gh pr view')).toBe('/base/sub')
    expect(cwdOf('cd -L sub && gh pr view')).toBe('/base/sub')
    expect(cwdOf('builtin cd sub && gh pr view')).toBe('/base/sub')
  })

  it('treats unknowable directories as unknown', () => {
    expect(cwdOf('cd "$X" && gh pr view')).toBeUndefined()
    expect(cwdOf('cd ~ && gh pr view')).toBeUndefined()
    expect(cwdOf('cd - && gh pr view')).toBeUndefined()
    expect(cwdOf('cd -P sub && gh pr view')).toBeUndefined()
    expect(cwdOf('cd a b && gh pr view')).toBeUndefined()
    expect(cwdOf('cd && gh pr view')).toBeUndefined()
    expect(cwdOf('cd x || gh pr view')).toBeUndefined()
    expect(cwdOf('true || cd x && gh pr view')).toBeUndefined()
    expect(cwdOf('if true; then cd x; fi; gh pr view')).toBeUndefined()
    expect(cwdOf('cd a && cd "$X" && gh pr view', '/base')).toBeUndefined()
  })

  it('ignores cd that cannot change the shell directory', () => {
    expect(cwdOf('echo | cd x && gh pr view')).toBe('/base')
    expect(cwdOf('sudo cd x && gh pr view')).toBe('/base')
    expect(cwdOf('cd x &')).toBe('/base')
  })

  it('scopes cd to subshells and skips function bodies', () => {
    expect(cwdOf('(cd sub && true); gh pr view')).toBe('/base')
    expect(cwdOf('(cd sub && gh pr view)')).toBe('/base/sub')
    expect(cwdOf('f() { cd sub; }; gh pr view')).toBe('/base')
    expect(cwdOf('function f { cd sub; }; gh pr view')).toBe('/base')
    expect(cwdOf('{ cd sub; }; gh pr view')).toBe('/base/sub')
    expect(cwdOf(') gh pr view')).toBe('/base')
    expect(cwdOf('} gh pr view')).toBe('/base')
  })

  it('applies env -C to the invocation', () => {
    expect(cwdOf('env -C /abs gh pr view')).toBe('/abs')
    expect(cwdOf('env -C rel gh pr view')).toBe('/base/rel')
    expect(cwdOf('cd "$X" && env -C rel gh pr view')).toBeUndefined()
    expect(cwdOf('cd "$X" && env -C /abs gh pr view')).toBe('/abs')
    expect(cwdOf('env -C "$D" gh pr view')).toBeUndefined()
  })
})
