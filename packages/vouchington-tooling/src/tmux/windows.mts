import { resolve } from 'node:path'

import type { TmuxSessionConfig, TmuxWindowConfig } from './config.mts'
import type { TmuxRun } from './runner.mts'
import { windowCommand } from './shell-quote.mts'

export type SessionContext = {
  config: TmuxSessionConfig
  root: string
  session: string
  /** Variables injected into every window, e.g. the log level. */
  extraEnv: Record<string, string>
  tmux: TmuxRun
  hasChildren: (pid: string) => boolean
  out: (text: string) => void
  err: (text: string) => void
}

export function windowCwd(context: SessionContext, window: TmuxWindowConfig): string {
  return resolve(context.root, window.cwd ?? '.')
}

export function commandFor(context: SessionContext, window: TmuxWindowConfig): string {
  return windowCommand(context.config, window, context.extraEnv)
}

function windowExists(context: SessionContext, name: string): boolean {
  const result = context.tmux(['list-windows', '-t', `=${context.session}`, '-F', '#{window_name}'])
  return result.stdout.split('\n').includes(name)
}

// A keep-open pane leaves its shell running after the command ends, so only a child process
// proves the command is alive. Without keepOpen the pane closes with the command, and bash may
// exec it directly (no child), so the window existing is the liveness signal.
function windowIsLive(context: SessionContext, window: TmuxWindowConfig): boolean {
  const name = window.name
  if (!windowExists(context, name)) return false
  if (!window.keepOpen) return true
  const result = context.tmux([
    'list-panes',
    '-t',
    `=${context.session}:${name}`,
    '-F',
    '#{pane_pid}',
  ])
  return result.stdout.split('\n').some((pid) => /^[0-9]+$/.test(pid) && context.hasChildren(pid))
}

export function decorateWindow(context: SessionContext, name: string): boolean {
  const target = `=${context.session}:${name}`
  return (
    context.tmux(['select-pane', '-T', name, '-t', target]).status === 0 &&
    context.tmux(['set-option', '-w', '-t', target, 'pane-border-status', 'top']).status === 0
  )
}

/** Respawn dead windows (or recreate missing ones). False when any step fails. */
export function restoreDeadWindows(context: SessionContext): boolean {
  for (const window of context.config.windows) {
    if (windowIsLive(context, window)) continue
    const base = ['-c', windowCwd(context, window), commandFor(context, window)]
    const target = `=${context.session}`
    const args = windowExists(context, window.name)
      ? ['respawn-pane', '-k', '-t', `${target}:${window.name}`, ...base]
      : ['new-window', '-d', '-t', target, '-n', window.name, ...base]
    if (context.tmux(args).status !== 0 || !decorateWindow(context, window.name)) return false
  }
  return true
}
