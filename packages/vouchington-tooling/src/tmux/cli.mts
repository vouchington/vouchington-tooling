import { readFileSync } from 'node:fs'

import { runScript } from '../cli/commands/spawn-script.mts'
import { packageScriptPath } from '../cli/script-path.mts'
import { TMUX_USAGE, type TmuxCliDeps } from './cli-shared.mts'
import { parseHookPayload } from './hook-payload.mts'
import { renderPostToolReminder } from './reminder-post-tool.mts'
import { runUp } from './up.mts'

export { TMUX_USAGE, type TmuxCliDeps }

const SCRIPTS: Record<string, string> = {
  name: 'scripts/tmux/tmux-name.sh',
  'read-title': 'scripts/tmux/tmux-read-title.sh',
  'agent-reminder': 'scripts/tmux/tmux-agent-reminder.sh',
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
