import { spawnSync } from 'node:child_process'

import { packageScriptPath } from '../cli/script-path.mts'
import { extractToolCommand, hookToolExitCode, hookToolName } from '../command-policy/payload.mts'
import type { HookPayload } from '../command-policy/types.mts'

const PR_CREATE_COMMAND_PATTERN = /(^|[;&|])\s*gh\s+pr\s+create(\s|$)/
const GIT_PUSH_COMMAND_PATTERN = /(^|[;&|])\s*git\s+push(\s|$)/
const RESET_WORKTREE_PATTERN =
  /(^|[;&|])\s*(?:\S*\/)?reset-worktree(?:\.sh)?(?:\s+(--help|-h))?(?=[;&|]|\s|$)/g
const SHELL_TOOLS = new Set(['Bash', 'Shell', 'run_terminal_command'])
const PR_SUFFIX_PATTERN = /-pr\d+$/
const transientSpawnCodes = new Set(['EAGAIN', 'EBUSY', 'EINTR', 'EMFILE', 'ENFILE', 'ETXTBSY'])
const transientStderrPattern =
  /\b(?:EAGAIN|EBUSY|EINTR|EMFILE|ENFILE|ETXTBSY)\b|resource temporarily unavailable|device or resource busy|interrupted system call|too many open files|text file busy/i
const spawnAttempts = 3

export type PaneTitleSpawnResult = {
  error?: NodeJS.ErrnoException | null | undefined
  status: number | null
  stdout: string
  stderr?: string
}

export type PaneTitleSpawn = (
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => PaneTitleSpawnResult

export type PostToolTmuxOptions = {
  env?: NodeJS.ProcessEnv | undefined
  spawnPaneTitle?: PaneTitleSpawn | undefined
  /** Command the reminder tells the agent to run. Default: `TMUX_NAME_COMMAND` or `vouchington tmux name`. */
  nameCommand?: string | undefined
}

function spawnReadTitle(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): PaneTitleSpawnResult {
  // Diagnostics are matched below, so request stable English errno text for this helper only.
  const result = spawnSync(command, [...args], { encoding: 'utf8', env: { ...env, LC_ALL: 'C' } })
  return {
    error: result.error,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

function paneTitle(env: NodeJS.ProcessEnv, spawn: PaneTitleSpawn): string | null {
  // The script validates the socket, pane, and worktree before reading, so a failed
  // lookup is not an empty pane title.
  const script = packageScriptPath('scripts/tmux/tmux-read-title.sh')
  for (let attempt = 0; attempt < spawnAttempts; attempt += 1) {
    const result = spawn('bash', [script], env)
    if (result.status === 0) return result.stdout.trim()
    const code = result.error?.code
    const retryableSpawn = typeof code === 'string' && transientSpawnCodes.has(code)
    if (!retryableSpawn && !transientStderrPattern.test(result.stderr ?? '')) return null
  }
  return null
}

// Scans every reset-worktree invocation separately: a compound command like
// `reset-worktree --help; reset-worktree --force` still runs a real reset.
function hasNonHelpResetInvocation(command: string): boolean {
  const pattern = new RegExp(RESET_WORKTREE_PATTERN.source, 'g')
  for (let match = pattern.exec(command); match !== null; match = pattern.exec(command)) {
    if (match[2] === undefined) return true
  }
  return false
}

/**
 * Remind the agent to (re)name its tmux window at the checkpoints a post-tool payload can
 * detect: a plan was accepted, a PR was created, a push landed without a `-pr<N>` title suffix,
 * or reset-worktree left a stale title. Silent (`null`) without a verified pane and for every
 * other tool call. The pane is read only after a checkpoint matches.
 */
export function renderPostToolReminder(
  payload: HookPayload,
  options: PostToolTmuxOptions = {},
): string | null {
  const env = { ...(options.env ?? process.env) }
  const spawn = options.spawnPaneTitle ?? spawnReadTitle
  const name = options.nameCommand ?? env.TMUX_NAME_COMMAND ?? 'vouchington tmux name'
  const hint = '(dangerouslyDisableSandbox: true)'
  const toolName = hookToolName(payload)

  if (toolName === 'ExitPlanMode') {
    if (paneTitle(env, spawn) === null) return null
    return `[tmux-window-name] Plan accepted — refine window name if scope shifted. ${name} <name>  ${hint}`
  }
  if (!SHELL_TOOLS.has(toolName)) return null

  const command = extractToolCommand(payload)
  const exitCode = hookToolExitCode(payload)
  if (command === '' || (exitCode !== undefined && exitCode !== 0)) return null

  if (PR_CREATE_COMMAND_PATTERN.test(command)) {
    if (paneTitle(env, spawn) === null) return null
    return `[tmux-window-name] PR created — add the -pr<N> suffix: ${name} <feature-pr123>  ${hint}`
  }
  if (GIT_PUSH_COMMAND_PATTERN.test(command)) {
    const title = paneTitle(env, spawn)
    if (title === null || PR_SUFFIX_PATTERN.test(title)) return null
    return `[tmux-window-name] git push on PR branch — confirm -pr<N> suffix is set: ${name} <feature-pr123>  ${hint}`
  }
  if (hasNonHelpResetInvocation(command)) {
    const title = paneTitle(env, spawn)
    if (title === null || title === '') return null
    return `[tmux-window-name] reset-worktree ran — pane title should be empty. ${name} ""  ${hint}`
  }
  return null
}
