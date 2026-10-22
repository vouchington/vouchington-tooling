import {
  commandFor,
  decorateWindow,
  restoreDeadWindows,
  windowCwd,
  type SessionContext,
} from './windows.mts'

export type LaunchOptions = {
  noAttach: boolean
  /** Pid recorded in the session environment to prove this launcher owns it. */
  pid: number
  sleep: (milliseconds: number) => void
  /** Whether the launcher process recorded in the session environment still runs. */
  isPidAlive: (pid: number) => boolean
}

const READY_ATTEMPTS = 99
const READY_POLL_MS = 100

function isReady(context: SessionContext): boolean {
  const marker = `@${context.config.readyMarker}`
  const result = context.tmux(['show-options', '-qv', '-t', `=${context.session}:`, marker])
  return result.stdout.trim() === '1'
}

function hasSession(context: SessionContext): boolean {
  return context.tmux(['has-session', '-t', `=${context.session}`]).status === 0
}

function finishExisting(context: SessionContext, options: LaunchOptions): number {
  if (options.noAttach) {
    context.out(`Services already running in tmux session '${context.session}'.\n`)
    return 0
  }
  context.out(`Reattaching to existing tmux session '${context.session}'...\n`)
  return context.tmux(['attach', '-t', `=${context.session}`], true).status ?? 1
}

function waitUntilReady(context: SessionContext, options: LaunchOptions): number {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    if (!hasSession(context)) {
      context.err(`Error: tmux session '${context.session}' disappeared during startup.\n`)
      return 1
    }
    options.sleep(READY_POLL_MS)
    if (isReady(context)) return 0
  }
  if (ownerIsDead(context, options)) {
    context.err(`Error: tmux session '${context.session}' was left unfinished; recreating it.\n`)
    context.tmux(['kill-session', '-t', `=${context.session}`])
    return 2
  }
  context.err(`Error: tmux session '${context.session}' did not finish startup.\n`)
  return 1
}

/** True when the session records a launcher pid and that process no longer exists. */
function ownerIsDead(context: SessionContext, options: LaunchOptions): boolean {
  const variable = context.config.launcherPidVar
  const result = context.tmux(['show-environment', '-t', `=${context.session}`, variable])
  const pid = /=([0-9]+)\s*$/.exec(result.stdout)?.[1]
  return pid !== undefined && !options.isPidAlive(Number(pid))
}

/** 0 = done, 2 = session was killed and must be recreated, other = failure. */
function reuseExisting(
  context: SessionContext,
  options: LaunchOptions,
  allowRestore: boolean,
): number {
  if (!isReady(context)) {
    const waited = waitUntilReady(context, options)
    if (waited !== 0) return waited
  } else if (allowRestore && !restoreDeadWindows(context)) {
    context.err('Error: failed to restore managed tmux windows; recreating session.\n')
    context.tmux(['kill-session', '-t', `=${context.session}`])
    return 2
  }
  return finishExisting(context, options)
}

function ownsSession(context: SessionContext, pid: number): boolean {
  const variable = context.config.launcherPidVar
  const result = context.tmux(['show-environment', '-t', `=${context.session}`, variable])
  return result.stdout.trim() === `${variable}=${pid}`
}

function createSession(context: SessionContext, options: LaunchOptions): number {
  const [first, ...rest] = context.config.windows
  const target = `=${context.session}`
  const created = context.tmux([
    'new-session',
    '-d',
    '-s',
    context.session,
    '-e',
    `${context.config.launcherPidVar}=${options.pid}`,
    '-n',
    first!.name,
    '-c',
    windowCwd(context, first!),
    commandFor(context, first!),
  ])
  if (created.status !== 0) {
    if (hasSession(context)) return reuseExisting(context, options, false)
    context.err(`Error: failed to create tmux session '${context.session}'.\n`)
    return 1
  }
  const steps: (readonly string[])[] = rest.map((window) => [
    'new-window',
    '-t',
    target,
    '-n',
    window.name,
    '-c',
    windowCwd(context, window),
    commandFor(context, window),
  ])
  const ok =
    decorateWindow(context, first!.name) &&
    rest.every(
      (window, index) =>
        context.tmux(steps[index]!).status === 0 && decorateWindow(context, window.name),
    ) &&
    context.tmux(['select-window', '-t', `${target}:${first!.name}`]).status === 0 &&
    context.tmux(['set-option', '-t', `${target}:`, `@${context.config.readyMarker}`, '1'])
      .status === 0
  if (!ok) {
    if (ownsSession(context, options.pid)) context.tmux(['kill-session', '-t', target])
    context.err(`Error: failed to start tmux session '${context.session}'.\n`)
    return 1
  }
  if (options.noAttach) {
    context.out(`Services started in tmux session '${context.session}'.\n`)
    context.out(`To attach: tmux attach -t '${context.session}'\n`)
    return 0
  }
  context.out(`Attaching to tmux session '${context.session}'...\n`)
  return context.tmux(['attach', '-t', target], true).status ?? 1
}

/** Start the configured windows in a worktree-scoped tmux session, or reuse a running one. */
export function launchSession(context: SessionContext, options: LaunchOptions): number {
  if (hasSession(context)) {
    const status = reuseExisting(context, options, true)
    if (status !== 2) return status
  }
  for (const line of context.config.summary) context.out(`${line}\n`)
  if (context.config.summary.length > 0) context.out('\n')
  return createSession(context, options)
}
