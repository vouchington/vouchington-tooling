import { readFileSync } from 'node:fs'

export type TmuxWindowConfig = {
  name: string
  /** Shell body run through `bash -lc`. */
  command: string
  /** Working directory, relative to the worktree root unless absolute. */
  cwd?: string
  env: Record<string, string>
  /** Keep the pane open after the command exits (appends `; read`). Default true. */
  keepOpen: boolean
}

export type TmuxSessionConfig = {
  /** Prepended to the worktree hash to form the tmux session name. */
  sessionPrefix: string
  /** Session option (without the leading `@`) set once every window exists. */
  readyMarker: string
  /** Variable recorded in the tmux session environment to identify the launcher. */
  launcherPidVar: string
  env: Record<string, string>
  windows: TmuxWindowConfig[]
  /** Lines printed before a fresh session starts. */
  summary: string[]
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
const TMUX_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
// A purely numeric window name would be read by tmux as an index.
const WINDOW_NAME = /^(?![0-9]+$)[A-Za-z0-9][A-Za-z0-9_.-]*$/
const OPTION_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, label: string, pattern?: RegExp): string {
  if (
    typeof value !== 'string' ||
    value === '' ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw new Error(`tmux config: ${label} must be a ${pattern ? 'valid ' : 'non-empty '}string`)
  }
  return value
}

function envMap(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error(`tmux config: ${label} must be an object`)
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!ENV_KEY.test(key)) throw new Error(`tmux config: ${label} has invalid name "${key}"`)
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      throw new Error(`tmux config: ${label}.${key} must be a string or number`)
    }
    result[key] = String(raw)
  }
  return result
}

function windowConfig(value: unknown, index: number): TmuxWindowConfig {
  const label = `windows[${index}]`
  if (!isRecord(value)) throw new Error(`tmux config: ${label} must be an object`)
  const cwd = value.cwd === undefined ? undefined : text(value.cwd, `${label}.cwd`)
  if (value.keepOpen !== undefined && typeof value.keepOpen !== 'boolean') {
    throw new Error(`tmux config: ${label}.keepOpen must be a boolean`)
  }
  return {
    name: text(value.name, `${label}.name`, WINDOW_NAME),
    command: text(value.command, `${label}.command`),
    ...(cwd === undefined ? {} : { cwd }),
    env: envMap(value.env, `${label}.env`),
    keepOpen: value.keepOpen ?? true,
  }
}

export function parseTmuxConfig(value: unknown): TmuxSessionConfig {
  if (!isRecord(value)) throw new Error('tmux config: expected a JSON object')
  if (!Array.isArray(value.windows) || value.windows.length === 0) {
    throw new Error('tmux config: windows must be a non-empty array')
  }
  const windows = value.windows.map(windowConfig)
  const names = new Set(windows.map((window) => window.name))
  if (names.size !== windows.length) throw new Error('tmux config: window names must be unique')
  const summary = value.summary ?? []
  if (!Array.isArray(summary) || summary.some((line) => typeof line !== 'string')) {
    throw new Error('tmux config: summary must be an array of strings')
  }
  return {
    sessionPrefix: text(value.sessionPrefix ?? 'dev-', 'sessionPrefix', TMUX_NAME),
    readyMarker: text(value.readyMarker ?? 'ready', 'readyMarker', OPTION_NAME),
    launcherPidVar: text(value.launcherPidVar ?? 'TMUX_LAUNCHER_PID', 'launcherPidVar', ENV_KEY),
    env: envMap(value.env, 'env'),
    windows,
    summary: summary as string[],
  }
}

export function loadTmuxConfig(path: string): TmuxSessionConfig {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`tmux config: cannot read ${path}: ${(error as Error).message}`, {
      cause: error,
    })
  }
  try {
    return parseTmuxConfig(JSON.parse(raw))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`tmux config: ${path} is not valid JSON`)
    throw error
  }
}
