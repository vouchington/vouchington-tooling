import type { TmuxSessionConfig, TmuxWindowConfig } from './config.mts'

export function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * The shell command tmux runs in a window: `bash -lc` with one quoted body that first exports
 * the extra, shared, then per-window environment and then runs the command. Exporting inside
 * the body (rather than prefixing `bash`) keeps a configured PATH from hiding `bash` itself and
 * lets the configured values win over login-profile defaults.
 */
export function windowCommand(
  config: TmuxSessionConfig,
  window: TmuxWindowConfig,
  extraEnv: Readonly<Record<string, string>> = {},
): string {
  const exports = Object.entries({ ...extraEnv, ...config.env, ...window.env })
    .map(([key, value]) => `export ${key}=${quoteShellArg(value)}; `)
    .join('')
  const body = `${exports}${window.command}${window.keepOpen ? '; read' : ''}`
  return `bash -lc ${quoteShellArg(body)}`
}
