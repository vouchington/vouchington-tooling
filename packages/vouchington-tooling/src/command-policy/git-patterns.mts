import { readBacktickSubstitution, readParenthesizedSubstitution } from '../shell-parse/index.mts'
import type { PatternRule } from './types.mts'

/**
 * Why a git command breaks the given rules, or null. Each rule reads one simple command: the span
 * after `git` stops at `|`, `;`, `&`, and newline, so a flag on a piped or chained command
 * (`git commit -F msg | tail -n 20`) is not a git flag. A command substitution's own separators
 * are blanked first, so `git push origin $(git branch --show-current | head -1) --force` is one
 * command.
 */
export function findBlockedPatternReason(
  command: string,
  rules: readonly PatternRule[],
): string | null {
  const text = blankSubstitutionSeparators(command)
  return rules.find(({ pattern }) => matches(pattern, text))?.reason ?? null
}

// A global or sticky pattern keeps `lastIndex` between tests, so reset it to keep decisions pure.
function matches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0
  return pattern.test(text)
}

function blankSubstitutionSeparators(command: string): string {
  let result = ''
  for (let index = 0; index < command.length; index += 1) {
    const endIndex = substitutionEndIndex(command, index)
    if (endIndex === null) {
      result += command[index]
      continue
    }
    result += command.slice(index, endIndex + 1).replace(/[|;&\n]/g, ' ')
    index = endIndex
  }
  return result
}

function substitutionEndIndex(command: string, index: number): number | null {
  if (command.startsWith('$(', index)) {
    return readParenthesizedSubstitution(command, index + 2)?.endIndex ?? null
  }
  if (command[index] === '`') {
    return readBacktickSubstitution(command, index + 1)?.endIndex ?? null
  }
  return null
}

export const PLAIN_FORCE_PUSH_REASON = 'Force pushes are banned by repository policy.'

/**
 * The generic git-hygiene bans, as an opt-in preset for `CommandPolicy.gitPatterns`: plain force
 * pushes, amends, ours/theirs strategies, and every way to skip git hooks. Each reason is
 * overridable; `pullRebaseReason` is the only one a repository usually rewrites, to name its own
 * rebase script.
 */
export function standardGitPatterns(
  reasons: { forcePush?: string; pullRebase?: string } = {},
): PatternRule[] {
  return [
    {
      pattern:
        /\bgit\s+push\b[^|;&\n]*\s(?:--force(?!-with-lease(?:\b|=))\b|--mirror\b|-[A-Za-z]*f[A-Za-z]*\b|\+[^;&|()\s]+)/,
      reason: reasons.forcePush ?? PLAIN_FORCE_PUSH_REASON,
    },
    {
      pattern: /\bgit\s+commit\b[^|;&\n]*--amend\b/,
      reason: 'Commit amend is banned by repository policy.',
    },
    {
      pattern: /\bgit\s+pull\b[^|;&\n]*(?:--rebase\b|\s-[A-Za-z]*r[A-Za-z]*\b)/,
      reason: reasons.pullRebase ?? 'git pull --rebase and git pull -r are banned.',
    },
    {
      pattern:
        /\bgit\b[^|;&\n]*(?:\s-X(?:=|\s)?(?:ours|theirs)\b|\s-X(?:ours|theirs)\b|\s(?:-s\s*|--strategy(?:=|\s+))ours\b|--strategy-option(?:=|\s+)(?:ours|theirs)\b)/,
      reason:
        'Git strategy options for ours/theirs are banned; during rebase they can silently keep the wrong side.',
    },
    {
      pattern: /\bgit\s+(?:checkout|restore)\b[^|;&\n]*(?:--ours|--theirs)\b/,
      reason: 'git checkout/restore --ours/--theirs is banned; resolve rebase conflicts manually.',
    },
    {
      pattern: /\bgit\b[^|;&\n]*--no-verify\b/,
      reason:
        '--no-verify bypasses repository git hooks. Fix the underlying failure instead of skipping hooks.',
    },
    {
      pattern: /\bgit\s+commit\b[^|;&\n]*\s-[A-Za-z]*n[A-Za-z]*\b/,
      reason:
        'git commit -n bypasses the commit-msg and pre-commit hooks. Fix the underlying failure instead.',
    },
    {
      pattern: /\bgit\b[^|;&\n]*-c\s+core\.hooksPath\s*=/i,
      reason: 'Overriding core.hooksPath disables git hooks. Fix the underlying failure instead.',
    },
  ]
}
