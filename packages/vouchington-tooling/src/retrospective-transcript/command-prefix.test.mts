import { describe, expect, it } from 'vitest'

import { normalizeCommandPrefix } from './command-prefix.mts'

describe('normalizeCommandPrefix', () => {
  it('normalizes a plain command to leading token + first subcommand', () => {
    expect(normalizeCommandPrefix('git status --short')).toBe('git status')
    expect(normalizeCommandPrefix('gh pr view 123 --json number')).toBe('gh pr')
  })

  it('falls back to the leading token alone when there is no second token', () => {
    expect(normalizeCommandPrefix('pwd')).toBe('pwd')
  })

  it('skips a leading git global option that takes a separate-token argument', () => {
    expect(normalizeCommandPrefix('git -C /repo status')).toBe('git status')
    expect(normalizeCommandPrefix('git -c user.name=x push')).toBe('git push')
  })

  it('skips a leading git global option with an inline =-joined argument', () => {
    expect(normalizeCommandPrefix('git --git-dir=/repo/.git status')).toBe('git status')
  })

  it('skips stacked git global options before the subcommand', () => {
    expect(normalizeCommandPrefix('git -C /repo -c user.name=x --no-pager status')).toBe(
      'git status',
    )
  })

  it('skips a no-arg git global option before the subcommand', () => {
    expect(normalizeCommandPrefix('git --no-pager log --oneline')).toBe('git log')
  })

  it('falls back to just "git" when only global options precede an empty subcommand', () => {
    expect(normalizeCommandPrefix('git -C /repo')).toBe('git')
  })

  it('goes one token deeper for a package-runner run/exec target', () => {
    expect(normalizeCommandPrefix('pnpm run build --filter web')).toBe('pnpm run build')
    expect(normalizeCommandPrefix('pnpm exec vitest run')).toBe('pnpm exec vitest')
    expect(normalizeCommandPrefix('npx tsx script.ts')).toBe('npx tsx')
  })

  it('does not go deeper for a package runner without a run/exec second token', () => {
    expect(normalizeCommandPrefix('pnpm install')).toBe('pnpm install')
  })

  it('normalizes only the first segment of a compound command', () => {
    expect(normalizeCommandPrefix('git status && git push origin main')).toBe('git status')
  })

  it('skips a leading cd prelude before choosing the actionable command', () => {
    expect(normalizeCommandPrefix('cd /repo && pnpm install')).toBe('pnpm install')
    expect(normalizeCommandPrefix('cd /repo; pnpm test')).toBe('pnpm test')
  })

  it('skips multiple leading cd preludes', () => {
    expect(normalizeCommandPrefix('cd /repo && cd sub && pnpm test')).toBe('pnpm test')
  })

  it('leaves a bare cd command unchanged when nothing follows it', () => {
    expect(normalizeCommandPrefix('cd /repo')).toBe('cd /repo')
  })

  it('preserves a path-qualified leading token without basename-stripping', () => {
    expect(normalizeCommandPrefix('/usr/bin/git status')).toBe('/usr/bin/git status')
  })

  it('returns an empty string for an empty command', () => {
    expect(normalizeCommandPrefix('')).toBe('')
  })

  // Privacy boundary: a shell segment with no internal whitespace tokenizes as one
  // word no matter how much payload it carries (a `VAR={...json...}` assignment, a
  // giant quoted argument). Redacting the whole token — never truncating it — is the
  // only way to guarantee no substring of that payload reaches default-mode output,
  // since a truncation-based cap would still leak whatever happens to sit at the
  // front (e.g. a secret embedded early in the value).
  it('redacts an overlong sole token instead of leaking its payload', () => {
    const command =
      'OLD_POLICY_JSON={"Version":"2012-10-17","Statement":[{"Sid":"SendFromNoReply",' +
      '"Effect":"Allow","Resource":["arn:aws:ses:us-west-2:123456789012:identity/example.com"]}]}'
    const prefix = normalizeCommandPrefix(command)
    expect(prefix).toBe('…')
    expect(prefix).not.toContain('123456789012')
  })

  it('redacts an overlong second token (e.g. a giant quoted argument) instead of leaking it', () => {
    const command = 'printf "expect(storeJobName).toContain(needs.detect-changes.outputs)"'
    const prefix = normalizeCommandPrefix(command)
    expect(prefix).toBe('printf …')
    expect(prefix).not.toContain('storeJobName')
  })

  it('leaves a token under the redaction threshold untouched', () => {
    expect(normalizeCommandPrefix('./scripts/name feature-branch-pr1')).toBe(
      './scripts/name feature-branch-pr1',
    )
  })

  it('strips a leading env-var assignment before normalizing the real command', () => {
    expect(normalizeCommandPrefix('CI=1 pnpm exec vitest run')).toBe('pnpm exec vitest')
    expect(normalizeCommandPrefix('GIT_EDITOR=true git rebase --continue')).toBe('git rebase')
  })

  it('strips multiple leading env-var assignments', () => {
    expect(normalizeCommandPrefix('CI=1 FORCE_COLOR=1 pnpm test')).toBe('pnpm test')
  })

  it('does not strip a lone assignment-shaped token with no command following it', () => {
    const command =
      'OLD_POLICY_JSON={"Version":"2012-10-17","Statement":[{"Sid":"SendFromNoReply",' +
      '"Effect":"Allow","Resource":["arn:aws:ses:us-west-2:123456789012:identity/example.com"]}]}'
    expect(normalizeCommandPrefix(command)).toBe('…')
  })

  it('redacts a path-qualified package-runner token that exceeds the redaction threshold', () => {
    const command = '/very/long/nested/path/to/node_modules/.bin/pnpm run build --filter web'
    const prefix = normalizeCommandPrefix(command)
    expect(prefix).toBe('… run build')
    expect(prefix).not.toContain('node_modules')
  })
})
