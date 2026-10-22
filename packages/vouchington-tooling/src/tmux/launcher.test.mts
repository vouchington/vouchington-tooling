import { describe, expect, it } from 'vitest'

import { createFakeTmux, lines } from './fake-tmux.test-helpers.mts'
import { launchSession } from './launcher.mts'

function created(calls: readonly string[][]): string[] {
  return calls
    .filter((call) => call[0] === 'new-session' || call[0] === 'new-window')
    .map((call) => call[call.indexOf('-n') + 1]!)
}

describe('launchSession: fresh session', () => {
  it('creates one window per config entry in order and marks the session ready', () => {
    const fake = createFakeTmux()
    expect(launchSession(fake.context(), fake.launch())).toBe(0)
    expect(created(fake.calls)).toEqual(['web', 'api', 'jobs'])
    const log = lines(fake.calls)
    expect(log).toContain('select-window -t =dev-dabc:web')
    expect(log).toContain('set-option -t =dev-dabc: @ready 1')
    expect(
      log.some((line) => line.startsWith('new-session -d -s dev-dabc -e TMUX_LAUNCHER_PID=4242')),
    ).toBe(true)
    expect(fake.calls.some((call) => call[0] === 'attach')).toBe(false)
    expect(fake.out.join('')).toContain('Web: http://localhost:3000\n\n')
    expect(fake.out.join('')).toContain("Services started in tmux session 'dev-dabc'.")
  })

  it('runs each window through bash -lc with merged env and its own cwd', () => {
    const fake = createFakeTmux()
    launchSession(fake.context(), fake.launch())
    const first = fake.calls.find((call) => call[0] === 'new-session')!
    expect(first.at(-2)).toBe('/work/web')
    expect(first.at(-1)).toBe(
      "bash -lc 'export TMUX_LOG_LEVEL='\\''error'\\''; export SHARED='\\''1'\\''; export SERVICE='\\''web'\\''; serve web; read'",
    )
    const second = fake.calls.find((call) => call[0] === 'new-window')!
    expect(second.at(-1)).toMatch(/serve api'$/)
    expect(second.at(-2)).toBe('/work')
  })

  it('decorates each window with a pane title and top border', () => {
    const fake = createFakeTmux()
    launchSession(fake.context(), fake.launch())
    const log = lines(fake.calls)
    expect(log).toContain('select-pane -T jobs -t =dev-dabc:jobs')
    expect(log).toContain('set-option -w -t =dev-dabc:jobs pane-border-status top')
  })

  it('prints no summary block when the config has none', () => {
    const fake = createFakeTmux()
    launchSession(fake.context({ ...fake.context().config, summary: [] }), fake.launch())
    expect(fake.out.join('')).not.toContain('\n\n')
  })

  it('attaches when attaching is allowed and returns tmux status', () => {
    const fake = createFakeTmux({ attachStatus: 3 })
    expect(launchSession(fake.context(), fake.launch(false))).toBe(3)
    expect(lines(fake.calls)).toContain('attach -t =dev-dabc')
    expect(fake.out.join('')).toContain("Attaching to tmux session 'dev-dabc'...")
  })

  it('reports status 1 when attach has no exit status', () => {
    const fake = createFakeTmux({ attachStatus: null })
    expect(launchSession(fake.context(), fake.launch(false))).toBe(1)
  })

  it('fails when the session cannot be created and does not exist afterwards', () => {
    const fake = createFakeTmux({ failOn: ['new-session'] })
    expect(launchSession(fake.context(), fake.launch())).toBe(1)
    expect(fake.err.join('')).toContain("failed to create tmux session 'dev-dabc'")
  })

  it('joins a session another launcher created concurrently', () => {
    const fake = createFakeTmux({ failOnce: 'new-session' })
    const real = fake.run
    let hasChecks = 0
    const context = {
      ...fake.context(),
      tmux: ((args, inherit) => {
        if (args[0] === 'has-session') {
          hasChecks += 1
          fake.state.exists = hasChecks > 1
        }
        return real(args, inherit)
      }) as typeof real,
    }
    expect(launchSession(context, fake.launch())).toBe(0)
    expect(fake.out.join('')).toContain('Services already running')
    expect(lines(fake.calls).filter((line) => line.startsWith('new-'))).toHaveLength(1)
  })

  it.each(['new-window', 'select-window', 'set-option'])(
    'kills the half-built session it owns when %s fails',
    (failing) => {
      const fake = createFakeTmux({ failOn: [failing], launcherPid: '4242' })
      expect(launchSession(fake.context(), fake.launch())).toBe(1)
      expect(lines(fake.calls)).toContain('kill-session -t =dev-dabc')
      expect(fake.err.join('')).toContain('failed to start tmux session')
    },
  )

  it('fails on pane decoration without killing a session another launcher owns', () => {
    const fake = createFakeTmux({ failOn: ['select-pane'], launcherPid: '1' })
    expect(launchSession(fake.context(), fake.launch())).toBe(1)
    expect(lines(fake.calls)).not.toContain('kill-session -t =dev-dabc')
  })

  it('fails when a later window cannot be decorated', () => {
    const fake = createFakeTmux({ launcherPid: '4242' })
    let selects = 0
    const real = fake.run
    const context = {
      ...fake.context(),
      tmux: ((args, inherit) => {
        if (args[0] === 'select-pane' && (selects += 1) === 2) return { status: 1, stdout: '' }
        return real(args, inherit)
      }) as typeof real,
    }
    expect(launchSession(context, fake.launch())).toBe(1)
  })
})

describe('launchSession: existing session', () => {
  it('reuses a ready session with all windows live', () => {
    const fake = createFakeTmux({ exists: true, windows: ['web', 'api', 'jobs'] })
    expect(launchSession(fake.context(), fake.launch())).toBe(0)
    expect(fake.out.join('')).toContain("Services already running in tmux session 'dev-dabc'.")
    expect(
      fake.calls.some((call) => ['respawn-pane', 'new-window', 'new-session'].includes(call[0]!)),
    ).toBe(false)
  })

  it('respawns only the dead window', () => {
    const fake = createFakeTmux({ exists: true, windows: ['web', 'api', 'jobs'], dead: ['jobs'] })
    expect(launchSession(fake.context(), fake.launch())).toBe(0)
    const respawns = lines(fake.calls).filter((line) => line.startsWith('respawn-pane'))
    expect(respawns).toHaveLength(1)
    expect(respawns[0]).toContain('-k -t =dev-dabc:jobs -c /work')
  })

  it('treats an existing window without keepOpen as live even when its pane has no child', () => {
    const fake = createFakeTmux({ exists: true, windows: ['web', 'api', 'jobs'], dead: ['api'] })
    expect(launchSession(fake.context(), fake.launch())).toBe(0)
    expect(fake.calls.some((call) => call[0] === 'respawn-pane')).toBe(false)
  })

  it('recreates a missing window without switching clients to it', () => {
    const fake = createFakeTmux({ exists: true, windows: ['web', 'api'] })
    expect(launchSession(fake.context(), fake.launch())).toBe(0)
    expect(created(fake.calls)).toEqual(['jobs'])
    expect(fake.calls.find((call) => call[0] === 'new-window')![1]).toBe('-d')
  })

  it('reports status 1 when reattaching has no exit status', () => {
    const fake = createFakeTmux({
      exists: true,
      windows: ['web', 'api', 'jobs'],
      attachStatus: null,
    })
    expect(launchSession(fake.context(), fake.launch(false))).toBe(1)
  })

  it('reattaches when attaching is allowed', () => {
    const fake = createFakeTmux({ exists: true, windows: ['web', 'api', 'jobs'] })
    expect(launchSession(fake.context(), fake.launch(false))).toBe(0)
    expect(fake.out.join('')).toContain('Reattaching')
    expect(lines(fake.calls)).toContain('attach -t =dev-dabc')
  })

  it('does not respawn after waiting for a not-yet-ready session', () => {
    const fake = createFakeTmux({ exists: true, dead: ['web'], readyAfter: 3, windows: ['web'] })
    expect(launchSession(fake.context(), fake.launch())).toBe(0)
    expect(fake.sleeps).toEqual([100, 100, 100])
    expect(fake.calls.some((call) => call[0] === 'respawn-pane')).toBe(false)
  })

  it('fails when the session never becomes ready', () => {
    const fake = createFakeTmux({ exists: true, neverReady: true })
    expect(launchSession(fake.context(), fake.launch())).toBe(1)
    expect(fake.sleeps).toHaveLength(99)
    expect(fake.err.join('')).toContain('did not finish startup')
  })

  it('recreates a never-ready session whose launcher is gone', () => {
    const fake = createFakeTmux({
      exists: true,
      neverReady: true,
      launcherPid: '99',
      ownerAlive: false,
    })
    expect(launchSession(fake.context(), fake.launch())).toBe(0)
    expect(fake.err.join('')).toContain('was left unfinished')
    expect(lines(fake.calls)).toContain('kill-session -t =dev-dabc')
    expect(created(fake.calls)).toEqual(['web', 'api', 'jobs'])
  })

  it('keeps waiting-failure semantics when the recorded launcher is still running', () => {
    const fake = createFakeTmux({ exists: true, neverReady: true, launcherPid: '99' })
    expect(launchSession(fake.context(), fake.launch())).toBe(1)
    expect(fake.err.join('')).toContain('did not finish startup')
  })

  it('fails when the session disappears while waiting', () => {
    const fake = createFakeTmux({ exists: true, neverReady: true, vanishAfterChecks: 2 })
    expect(launchSession(fake.context(), fake.launch())).toBe(1)
    expect(fake.err.join('')).toContain('disappeared during startup')
  })

  it('kills and recreates the session when restoring a window fails', () => {
    const fake = createFakeTmux({
      exists: true,
      windows: ['web', 'api', 'jobs'],
      dead: ['web'],
      failOnce: 'respawn-pane',
    })
    expect(launchSession(fake.context(), fake.launch())).toBe(0)
    expect(fake.err.join('')).toContain('recreating session')
    expect(lines(fake.calls)).toContain('kill-session -t =dev-dabc')
    expect(created(fake.calls)).toEqual(['web', 'api', 'jobs'])
  })

  it('kills and recreates when decorating a restored window fails', () => {
    const fake = createFakeTmux({
      exists: true,
      windows: ['web', 'api', 'jobs'],
      dead: ['web'],
      failOnce: 'select-pane',
    })
    expect(launchSession(fake.context(), fake.launch())).toBe(0)
    expect(fake.err.join('')).toContain('recreating session')
  })

  it('kills and recreates when the pane-border option of a restored window fails', () => {
    const fake = createFakeTmux({
      exists: true,
      windows: ['web', 'api', 'jobs'],
      dead: ['web'],
      failOnce: 'set-option',
    })
    expect(launchSession(fake.context(), fake.launch())).toBe(0)
    expect(fake.err.join('')).toContain('recreating session')
  })
})
