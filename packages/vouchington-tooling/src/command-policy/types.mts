export type HookPayload = {
  tool_input?: unknown
  toolInput?: unknown
  session_id?: unknown
  sessionId?: unknown
  conversation_id?: unknown
  tool_name?: unknown
  toolName?: unknown
  command?: unknown
  cwd?: unknown
  workspaceRoot?: unknown
  [key: string]: unknown
}

export type BlockDecision = {
  reason: string
  /**
   * 'block' (the default when omitted) rejects the tool call outright. 'confirm' marks an
   * interactive lone merge, which a caller may render as a silent allow in an attended session.
   * Only `findInteractiveMergeConfirm` produces 'confirm', and the engine consults it after every
   * block, so a block anywhere in the command always wins.
   */
  disposition?: 'block' | 'confirm'
}

export type PatternRule = { pattern: RegExp; reason: string }

/** Paths that automation must not write. Directory prefixes end in `/`. */
export type ProtectedPaths = {
  dirPrefixes: readonly string[]
  exactFiles: readonly string[]
  reason: string
}

/** A mistyped path segment (for example a misspelled dot-directory) and the reason to refuse it. */
export type PathTypoRule = { segment: string; reason: string }

/** Read-only git probes; every one returns undefined when git cannot answer. */
export type GitProbe = {
  currentBranch(cwd: string): string | undefined
  configValue(cwd: string, key: string): string | undefined
  isAncestor(cwd: string, ancestor: string, descendant: string): boolean | undefined
  resolveRef(cwd: string, ref: string): string | undefined
}

export type StackPolicy = {
  /** Branch a stack must root on and a PR must target. Defaults to `main`. */
  baseBranch?: string
  /** Remote whose `<remote>/<baseBranch>` HEAD must descend from. Defaults to `origin`. */
  remote?: string
  /** Appended to stack reasons, for example a pointer to the repository's stacking skill. */
  guidance?: string
  /** What to do after a draft PR opens, for example the description tool to call. */
  draftFollowUp?: string
  /** Probe override for tests and sandboxes. */
  git?: GitProbe
}

export type CommandPolicy = {
  typoPaths?: readonly PathTypoRule[]
  protectedPaths?: ProtectedPaths
  /** Tested against every command and nested script, before the git rules. */
  commandPatterns?: readonly PatternRule[]
  /** Tested against nested scripts, only when the command mentions git. */
  gitPatterns?: readonly PatternRule[]
  /** Reason for an interactive `git rebase --continue`; omit to allow it. */
  rebaseContinueReason?: string
  /** Appended to merge reasons, for example a pointer to the merge-authority document. */
  mergeGuidance?: string
  /** GitHub stack rules apply only when this is present. */
  stack?: StackPolicy
}

export type EvaluateOptions = {
  /** Whether the call runs in unattended automation. Defaults to true, the strict choice. */
  automationContext?: boolean
  /** Directory the call runs in. Defaults to the payload's own, else `process.cwd()`. */
  cwd?: string
}
