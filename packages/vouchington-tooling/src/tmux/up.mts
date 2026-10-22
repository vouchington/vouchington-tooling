import { resolve } from 'node:path'

import { TMUX_USAGE, type TmuxCliDeps } from './cli-shared.mts'
import { loadTmuxConfig } from './config.mts'
import { launchSession } from './launcher.mts'
import { createTmuxRun, pgrepHasChildren, sleepMs } from './runner.mts'
import { tmuxSessionName } from './session-name.mts'

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

export function runUp(args: readonly string[], deps: TmuxCliDeps): number {
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
  const cwd = deps.cwd ?? process.cwd()
  const root = resolve(cwd, flags.root ?? env.TMUX_TARGET_ROOT ?? '.')
  try {
    const config = loadTmuxConfig(resolve(cwd, flags.config!))
    const context = {
      config,
      root,
      session: tmuxSessionName(config.sessionPrefix, root),
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
