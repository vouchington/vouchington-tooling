import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { runScript, type ScriptSpawn } from '../cli/commands/spawn-script.mts'
import { packageScriptPath } from '../cli/script-path.mts'
import { loadTmuxConfig } from './config.mts'
import { launchSession } from './launcher.mts'
import { parseHookPayload } from './hook-payload.mts'
import { renderPostToolReminder, type PaneTitleSpawn } from './reminder-post-tool.mts'
import { createTmuxRun, pgrepHasChildren, sleepMs, type TmuxRun } from './runner.mts'
import { tmuxSessionName } from './session-name.mts'

export const TMUX_USAGE = `tmux up --config <file> [--root <dir>] [--no-attach] [-v|--verbose]
tmux name [--socket PATH --pane %ID --worktree PATH] <name>
tmux read-title
tmux agent-reminder session-start|user-prompt
tmux post-tool  (hook payload on stdin)
  Environment: TMUX_TARGET_BIN (tmux binary), TMUX_TARGET_ROOT (worktree, default cwd),
  TMUX_NAME_COMMAND (rename command named in reminders), AGENT_TMUX_SOCKET/PANE/WORKTREE.
`

const SCRIPTS: Record<string, string> = {
  name: 'scripts/tmux/tmux-name.sh',
  'read-title': 'scripts/tmux/tmux-read-title.sh',
  'agent-reminder': 'scripts/tmux/tmux-agent-reminder.sh',
}

export type TmuxCliDeps = {
  env?: NodeJS.ProcessEnv
  cwd?: string
  spawn?: ScriptSpawn
  readStdin?: () => string
  tmux?: TmuxRun
  hasChildren?: (pid: string) => boolean
  sleep?: (milliseconds: number) => void
  spawnPaneTitle?: PaneTitleSpawn
  out?: (text: string) => void
  err?: (text: string) => void
  pid?: number
}

type UpFlags = { config?: string; root?: string; noAttach: boolean; verbose: boolean }

function parseUp(args: readonly string[]): UpFlags | string {
  const flags: UpFlags = { noAttach: false, verbose: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === '--no-attach' || arg === '--verbose' || arg === '-v') {
      const key = arg === '--no-attach' ? 'noAttach' : 'verbose'
      if (flags[key]) return `duplicate option: ${arg}`
      flags[key] = true
    } else if (arg === '--config' || arg === '--root') {
      const value = args[index + 1]
      if (value === undefined || value === '') return `missing value for ${arg}`
      flags[arg === '--config' ? 'config' : 'root'] = value
      index += 1
    } else {
      return `unknown option: ${arg}`
    }
  }
  return flags.config === undefined ? '--config is required' : flags
}

function runUp(args: readonly string[], deps: TmuxCliDeps): number {
  const err = deps.err ?? ((text) => void process.stderr.write(text))
  const env = deps.env ?? process.env
  const flags = parseUp(args)
  if (typeof flags === 'string') {
    err(`vouchington: ${flags}\n${TMUX_USAGE}`)
    return 2
  }
  const tmux = deps.tmux ?? createTmuxRun(env.TMUX_TARGET_BIN || 'tmux')
  if (tmux(['-V']).status !== 0) {
    err('Error: tmux is not installed.\n')
    return 1
  }
  if (env.TMUX && !flags.noAttach) {
    err('Error: run this outside tmux. Pass --no-attach to start services without attaching.\n')
    return 1
  }
  const root = resolve(deps.cwd ?? process.cwd(), flags.root ?? env.TMUX_TARGET_ROOT ?? '.')
  try {
    const config = loadTmuxConfig(resolve(deps.cwd ?? process.cwd(), flags.config!))
    const session = tmuxSessionName(config.sessionPrefix, root)
    const context = {
      config,
      root,
      session,
      extraEnv: { TMUX_LOG_LEVEL: flags.verbose ? 'info' : 'error' },
      tmux,
      hasChildren: deps.hasChildren ?? pgrepHasChildren,
      out: deps.out ?? ((text: string) => void process.stdout.write(text)),
      err,
    }
    const sleep = deps.sleep ?? sleepMs
    return launchSession(context, { noAttach: flags.noAttach, pid: deps.pid ?? process.pid, sleep })
  } catch (error) {
    err(`vouchington: ${(error as Error).message}\n`)
    return 2
  }
}

export function runTmuxCommand(args: readonly string[], deps: TmuxCliDeps = {}): number {
  const [subcommand, ...rest] = args
  const script = subcommand === undefined ? undefined : SCRIPTS[subcommand]
  if (script !== undefined) return runScript('bash', packageScriptPath(script), rest, deps.spawn)
  if (subcommand === 'up') return runUp(rest, deps)
  if (subcommand === 'post-tool' && rest.length === 0) {
    const stdin = deps.readStdin ?? (() => readFileSync(0, 'utf8'))
    const reminder = renderPostToolReminder(parseHookPayload(stdin()), {
      env: deps.env,
      spawnPaneTitle: deps.spawnPaneTitle,
    })
    if (reminder !== null)
      (deps.out ?? ((text) => void process.stdout.write(text)))(`${reminder}\n`)
    return 0
  }
  ;(deps.err ?? ((text) => void process.stderr.write(text)))(
    `vouchington: expected: up|name|read-title|agent-reminder|post-tool\n${TMUX_USAGE}`,
  )
  return 2
}
