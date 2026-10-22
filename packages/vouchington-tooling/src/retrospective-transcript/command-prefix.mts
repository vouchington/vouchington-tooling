import { isPackageRunner, splitCommandSegments } from './command-segments.mts'

// A real command/subcommand token (binary name, git subcommand, short flag, script
// name) is always well under this length. A token that exceeds it isn't a command
// token at all — it's payload that got tokenized as one word because it had no
// internal whitespace (a `VAR={...json...}` assignment, a giant quoted printf arg).
// Such tokens are replaced with a redaction marker rather than truncated: truncation
// still leaks a prefix of whatever the token contains (a secret can sit at the front,
// e.g. "AWS_SECRET_ACCESS_KEY=AKIA..."), while a full-token redaction leaks nothing
// regardless of where sensitive content falls inside it. This intentionally also
// redacts long-but-benign tokens (e.g. a `cd /very/long/worktree/path` argument) —
// for a privacy boundary, over-redacting a legitimate token is the safe failure mode.
const MAX_COMMAND_TOKEN_LENGTH = 40
const REDACTED_TOKEN = '…'

export function redactOverlongToken(token: string): string {
  return token.length > MAX_COMMAND_TOKEN_LENGTH ? REDACTED_TOKEN : token
}

const ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/

// A segment's real command starts after any leading `VAR=value` assignments (e.g.
// "CI=1 pnpm exec vitest", "GIT_EDITOR=true git rebase --continue" — both real
// patterns used in real agent sessions). Without stripping these, the
// env-var token itself gets normalized as if it were the command, so "CI=1 pnpm exec
// vitest" would classify as prefix "CI=1 pnpm" instead of "pnpm exec vitest". Only
// strips when a token remains afterward — a segment that is *entirely*
// assignment-shaped tokens (e.g. a lone `OLD_POLICY_JSON={...}` token with no
// whitespace) has no command to recover, and is left alone so it still falls through
// to the general redaction path below instead of normalizing to an empty prefix.
function stripEnvPrefix(segment: string[]): string[] {
  const index = segment.findIndex((token) => !ENV_ASSIGNMENT_PATTERN.test(token))
  return index === -1 ? segment : segment.slice(index)
}

// Git global options precede the real subcommand — "git -C <path> status" and
// "git status" are the same command family for policy-matching purposes (`git -h`
// documents `git [-C <path>] [-c <name>=<value>] ... <command> [<args>]`). `-C`/`-c`
// take a separate-token argument; `--git-dir=<path>`-style options fold their argument
// into one `=`-joined token; the rest take no argument at all. Skipping them keeps the
// normalized prefix on the subcommand instead of stalling on the option — without this,
// e.g. `git -C <worktree> status` normalizes to "git -C" and reports as an uncovered
// escalation/block candidate under the wrong prefix, even though `git status` is
// already covered by an existing narrow allow rule.
const GIT_GLOBAL_OPTIONS_WITH_ARG = new Set(['-C', '-c'])
const GIT_GLOBAL_OPTIONS_NO_ARG = new Set([
  '-v',
  '--version',
  '-h',
  '--help',
  '--exec-path',
  '--html-path',
  '--man-path',
  '--info-path',
  '-p',
  '--paginate',
  '-P',
  '--no-pager',
  '--no-replace-objects',
  '--bare',
])
const GIT_GLOBAL_OPTION_WITH_INLINE_ARG = /^--[a-z-]+=/

function stripGitGlobalOptions(tokens: string[]): string[] {
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index] as string
    if (GIT_GLOBAL_OPTIONS_WITH_ARG.has(token)) index += 2
    else if (GIT_GLOBAL_OPTIONS_NO_ARG.has(token) || GIT_GLOBAL_OPTION_WITH_INLINE_ARG.test(token))
      index += 1
    else break
  }
  return tokens.slice(index)
}

// Normalizes a segment to "<leading token> <first subcommand>" (e.g. "git status",
// "gh pr", or just "cat" when there's no second token), with one exception that goes
// one token deeper because a permissions file may distinguish at that depth:
// package runners — "pnpm run build" vs "pnpm exec build" are different
// permission entries, so the run/exec target must
// stay out of the generic two-token rule.
function normalizeSegment(segment: string[]): string {
  const [first, ...rest] = segment
  if (!first) return ''
  // A segment that is only assignments (stripEnvPrefix left it intact) has no command;
  // its value may be a secret of any length, so always redact it.
  if (ENV_ASSIGNMENT_PATTERN.test(first)) return REDACTED_TOKEN
  if (isPackageRunner(first) && (rest[0] === 'run' || rest[0] === 'exec') && rest[1]) {
    return `${redactOverlongToken(first)} ${rest[0]} ${redactOverlongToken(rest[1])}`
  }
  const effectiveRest = first === 'git' ? stripGitGlobalOptions(rest) : rest
  return effectiveRest[0]
    ? `${redactOverlongToken(first)} ${redactOverlongToken(effectiveRest[0])}`
    : redactOverlongToken(first)
}

// A leading "cd <path> && ..." (or "cd <path>; ...") prelude is not itself the
// actionable command — it's a workdir change common in Bash sessions with no separate
// cwd param. Without skipping it, "cd /repo && pnpm install" would normalize to "cd
// /repo" and both miss existing pnpm policy coverage and leak a checkout path into
// non-raw retro output. Only a *leading run* of cd segments is skipped — a bare `cd
// /repo` with nothing after it has no other segment to fall back to, so it still
// normalizes as-is.
function skipLeadingCdSegments(segments: string[][]): string[][] {
  let index = 0
  while (index < segments.length - 1 && stripEnvPrefix(segments[index] as string[])[0] === 'cd')
    index++
  return segments.slice(index)
}

// Produces a classification key for a raw shell command, for comparison against the
// prefix lists in a consumer permissions file (excluded commands, allow,
// and deny lists). This is a privacy
// boundary: callers building non---raw report output must emit only this normalized
// prefix, never the raw `command` string.
//
// Only the first non-cd segment of a compound command (`git status && git push`) is
// normalized — this is a rough per-command categorization tool, not a full command
// parser, so a compound command is bucketed by its first actionable part.
//
// The leading token is preserved as-is (no basename stripping for a path-qualified
// binary like "/usr/bin/git"):
// permissions files may also list literal relative-path scripts (e.g. "./scripts/run")
// that must not be collapsed to a basename.
export function normalizeCommandPrefix(command: string): string {
  const segments = skipLeadingCdSegments(splitCommandSegments(command))
  const segment = stripEnvPrefix(segments[0] ?? [])
  return normalizeSegment(segment)
}
