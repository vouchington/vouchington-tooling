import type { TmuxSessionConfig, TmuxWindowConfig } from './config.mts'

export function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * The shell command tmux runs in a window: shared then per-window environment
 * assignments, then `bash -lc` with the body quoted as one argument.
 */
export function windowCommand(
  config: TmuxSessionConfig,
  window: TmuxWindowConfig,
  extraEnv: Readonly<Record<string, string>> = {},
): string {
  const assignments = Object.entries({ ...extraEnv, ...config.env, ...window.env })
    .map(([key, value]) => `${key}=${quoteShellArg(value)}`)
    .join(' ')
  const body = window.keepOpen ? `${window.command}; read` : window.command
  return `${assignments === '' ? '' : `${assignments} `}bash -lc ${quoteShellArg(body)}`
}
