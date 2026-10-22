import type { CommandPolicy, HookPayload } from '../types.mts'

export const HOOK_HARNESSES = ['claude', 'codex', 'cursor', 'grok'] as const

export type HookHarness = (typeof HOOK_HARNESSES)[number]

export type HookContext = {
  harness: HookHarness
  payload: HookPayload
  env: NodeJS.ProcessEnv
  /** Repository root: `--root`, else the hook process's working directory. */
  root: string
}

export type PostToolUseWarning = { level: 'warn' | 'error'; message: string }

/** A file check run after an Edit/Write. `filePath` is as the tool reported it. */
export type PostToolUseChecker = {
  matches: (filePath: string, root: string) => boolean
  check: (filePath: string, root: string) => PostToolUseWarning[]
}

/** What a `--policy <module>` exports, as its default export or a function returning it. */
export type HookPolicy = {
  /** Rule table for `pre-tool-use`. Without it the hook has no opinion. */
  command?: CommandPolicy
  /** File checks for `post-tool-use`. */
  checkers?: readonly PostToolUseChecker[]
  /** Extra context for the model after a tool call, or nothing. Must not throw to matter. */
  reminder?: (
    context: HookContext,
  ) => string | null | undefined | Promise<string | null | undefined>
  /** Runs first on both events, for example to persist the harness session id. */
  onPayload?: (context: HookContext) => void | Promise<void>
}

export type HookPolicyExport =
  | HookPolicy
  | ((context: HookContext) => HookPolicy | Promise<HookPolicy>)

/** Identity helper that types a policy module's default export. */
export function defineHookPolicy<T extends HookPolicyExport>(policy: T): T {
  return policy
}
