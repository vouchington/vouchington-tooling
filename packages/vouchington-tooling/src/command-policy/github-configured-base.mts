import { lastNamedOption } from './github-option-flags.mts'
import type { BlockDecision, GitProbe } from './types.mts'

export type ResolvedStackPolicy = {
  baseBranch: string
  remote: string
  guidance: string
  draftFollowUp: string
  git: GitProbe
}

/** Appends the caller's guidance to a reason. */
export function withGuidance(reason: string, guidance: string): string {
  return guidance === '' ? reason : `${reason} ${guidance}`
}

/**
 * Effective base `gh pr create` uses when `--base`/`-B` is omitted:
 * `branch.<current>.gh-merge-base`, else undefined (repo default).
 */
export function configuredPullRequestBase(cwd: string, git: GitProbe): string | undefined {
  const branch = git.currentBranch(cwd)
  return branch === undefined ? undefined : git.configValue(cwd, `branch.${branch}.gh-merge-base`)
}

/**
 * Root guard for `gh stack init`: a stack rooted off the base branch cannot drain if its parent is
 * ever abandoned. Scoped to `init` only, since `gh stack add` only appends to an existing stack. An
 * explicit `--base` needs no checkout; the HEAD ancestry and local-base freshness checks read
 * `cwd`, so an unknown `cwd` skips just those. gh-stack roots the first layer at the local base
 * branch, never the remote one, so a stale local base misroots the stack even when HEAD passed the
 * ancestry check. A missing local base is fine: gh-stack creates it from the remote.
 */
export function findStackInitBaseBlock(
  optionTokens: string[],
  cwd: string | undefined,
  policy: ResolvedStackPolicy,
): BlockDecision | null {
  const { baseBranch, git, guidance, remote } = policy
  const remoteBase = `${remote}/${baseBranch}`
  const base = lastNamedOption(optionTokens, 'base', 'b')
  if (base !== undefined && base !== baseBranch) {
    return {
      reason: withGuidance(
        `gh stack init must root on ${baseBranch}, not an unmerged branch - omit --base/-b (it defaults to the repo default branch) or pass --base ${baseBranch}.`,
        guidance,
      ),
    }
  }
  if (cwd !== undefined && git.isAncestor(cwd, 'HEAD', remoteBase) === false) {
    return {
      reason: withGuidance(
        `gh stack init must run from a commit already merged into ${remoteBase} (HEAD is not an ancestor of ${remoteBase}) - check out an up-to-date ${baseBranch} before initializing a stack.`,
        guidance,
      ),
    }
  }
  const localBase = cwd === undefined ? undefined : git.resolveRef(cwd, `refs/heads/${baseBranch}`)
  const remoteHead =
    cwd === undefined ? undefined : git.resolveRef(cwd, `refs/remotes/${remote}/${baseBranch}`)
  if (localBase !== undefined && remoteHead !== undefined && localBase !== remoteHead) {
    return {
      reason: withGuidance(
        `gh stack init roots the stack at local \`${baseBranch}\`, which differs from ${remoteBase} (stale local ${baseBranch}). Fast-forward it first without touching another checkout: if no worktree has ${baseBranch} checked out, run \`git fetch ${remote} ${baseBranch}:${baseBranch}\`; if it is checked out in the primary checkout, have that checkout fast-forward itself - never move ${baseBranch} from this worktree, and do not check it out here.`,
        guidance,
      ),
    }
  }
  return null
}

// An explicit `--base` needs no checkout; only the configured default reads gh's directory, so a
// `cwd` the hook cannot resolve skips just that fallback.
export function findHandRolledStackBaseBlock(
  action: string,
  optionTokens: string[],
  cwd: string | undefined,
  policy: ResolvedStackPolicy,
): BlockDecision | null {
  const base = lastNamedOption(optionTokens, 'base', 'B')
  const effectiveBase =
    base ??
    (cwd !== undefined && (action === 'create' || action === 'new')
      ? configuredPullRequestBase(cwd, policy.git)
      : undefined)
  if (effectiveBase === undefined || effectiveBase === policy.baseBranch) {
    return null
  }
  return {
    reason: withGuidance(
      `PRs must target ${policy.baseBranch} unless they are part of a native GitHub stack. Use \`gh stack\`, not \`gh pr create/edit --base <unmerged-branch>\`.`,
      policy.guidance,
    ),
  }
}
