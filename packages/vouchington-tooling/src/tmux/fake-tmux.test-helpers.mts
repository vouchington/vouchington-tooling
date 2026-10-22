import type { TmuxSessionConfig } from './config.mts'
import type { TmuxResult, TmuxRun } from './runner.mts'
import type { SessionContext } from './windows.mts'

export type FakeTmuxOptions = {
  exists?: boolean
  windows?: string[]
  dead?: string[]
  /** Polls of the ready option that report not-ready before it becomes `1`. */
  readyAfter?: number
  /** Never ready. */
  neverReady?: boolean
  /** The session vanishes after this many has-session calls. */
  vanishAfterChecks?: number
  /** Subcommands (first argument) that exit 1. */
  failOn?: string[]
  /** Subcommand to fail only the first time it runs. */
  failOnce?: string
  /** Environment value returned for the launcher pid variable. */
  launcherPid?: string
  attachStatus?: number | null
}

const sampleConfig: TmuxSessionConfig = {
  sessionPrefix: 'dev-',
  readyMarker: 'ready',
  launcherPidVar: 'TMUX_LAUNCHER_PID',
  env: { SHARED: '1' },
  summary: ['Web: http://localhost:3000'],
  windows: [
    { name: 'web', command: 'serve web', cwd: 'web', env: { SERVICE: 'web' }, keepOpen: true },
    { name: 'api', command: 'serve api', env: {}, keepOpen: false },
    { name: 'jobs', command: 'serve jobs', env: {}, keepOpen: true },
  ],
}

export function createFakeTmux(options: FakeTmuxOptions = {}) {
  const state = {
    exists: options.exists ?? false,
    windows: [...(options.windows ?? [])],
    polls: 0,
    checks: 0,
    failedOnce: false,
  }
  const calls: string[][] = []
  const pids = new Map<string, string>()
  const deadPids = new Set<string>()
  const pidFor = (name: string): string => {
    if (!pids.has(name)) {
      pids.set(name, String(1000 + pids.size))
      if (options.dead?.includes(name)) deadPids.add(pids.get(name)!)
    }
    return pids.get(name)!
  }
  const ok = (stdout = ''): TmuxResult => ({ status: 0, stdout })
  const fail: TmuxResult = { status: 1, stdout: '' }

  const run: TmuxRun = (args) => {
    calls.push([...args])
    const [command = '', ...rest] = args
    if (options.failOn?.includes(command)) return fail
    if (options.failOnce === command && !state.failedOnce) {
      state.failedOnce = true
      return fail
    }
    switch (command) {
      case '-V':
        return ok('tmux 3.5\n')
      case 'has-session':
        state.checks += 1
        if (options.vanishAfterChecks !== undefined && state.checks > options.vanishAfterChecks) {
          state.exists = false
        }
        return state.exists ? ok() : fail
      case 'show-options': {
        state.polls += 1
        const ready = !options.neverReady && state.polls > (options.readyAfter ?? 0)
        return ok(ready ? '1\n' : '')
      }
      case 'show-environment':
        return ok(`${rest[2]}=${options.launcherPid ?? ''}\n`)
      case 'list-windows':
        return ok(state.windows.join('\n'))
      case 'list-panes': {
        const name = rest[1]!.split(':')[1]!
        return ok(`${pidFor(name)}\nnot-a-pid\n`)
      }
      case 'new-session':
        state.exists = true
        state.windows.push(rest[rest.indexOf('-n') + 1]!)
        return ok()
      case 'new-window':
        state.windows.push(rest[rest.indexOf('-n') + 1]!)
        return ok()
      case 'kill-session':
        state.exists = false
        return ok()
      case 'attach':
        return { status: options.attachStatus === undefined ? 0 : options.attachStatus, stdout: '' }
      default:
        return ok()
    }
  }

  const out: string[] = []
  const err: string[] = []
  const sleeps: number[] = []
  const context = (config: TmuxSessionConfig = sampleConfig): SessionContext => ({
    config,
    root: '/work',
    session: 'dev-dabc',
    extraEnv: { TMUX_LOG_LEVEL: 'error' },
    tmux: run,
    hasChildren: (pid) => !deadPids.has(pid),
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
  })
  const launch = (noAttach = true) => ({
    noAttach,
    pid: 4242,
    sleep: (ms: number) => void sleeps.push(ms),
  })
  return { run, calls, out, err, sleeps, state, context, launch }
}

/** Subcommand lines, e.g. `new-window -t =dev-dabc -n web ...`. */
export function lines(calls: readonly string[][]): string[] {
  return calls.map((call) => call.join(' '))
}
