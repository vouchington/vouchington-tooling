import type { ScriptSpawn } from '../cli/commands/spawn-script.mts'
import type { PaneTitleSpawn } from './reminder-post-tool.mts'
import type { TmuxRun } from './runner.mts'

export const TMUX_USAGE = `tmux up --config <file> [--root <dir>] [--no-attach] [-v|--verbose]
tmux name [--socket PATH --pane %ID --worktree PATH] <name>
tmux read-title
tmux agent-reminder session-start|user-prompt
tmux post-tool  (hook payload on stdin)
  Environment: TMUX_TARGET_BIN (tmux binary), TMUX_TARGET_ROOT (worktree, default cwd),
  TMUX_NAME_COMMAND (rename command named in reminders), AGENT_TMUX_SOCKET/PANE/WORKTREE.
`

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
