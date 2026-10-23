import { EventEmitter } from 'node:events'

import { expect } from 'vitest'

import type { StorybookBrowserProject, StorybookBrowserRunnerDeps } from './types.mts'

export const PROJECT_NAME = 'browser-suite'
export const PROJECT: StorybookBrowserProject = {
  completionFile: '.vitest-reports/browser-suite.json',
  optimizeDepsConfigPath: 'config/optimize-deps.mts',
  projectName: PROJECT_NAME,
  resultFiles: ['.vitest-reports/browser-suite.json', 'coverage/lcov.info'],
}

export type Child = EventEmitter & {
  kill: (signal: NodeJS.Signals) => boolean
  pid: number | undefined
  stderr: EventEmitter
  stdout: EventEmitter
}

export function makeChild(pid: number | undefined): Child {
  return Object.assign(new EventEmitter(), {
    kill: () => true,
    pid,
    stderr: new EventEmitter(),
    stdout: new EventEmitter(),
  })
}

export type FakeOptions = {
  exists?: (path: string) => boolean
  isProcessGroupAlive?: StorybookBrowserRunnerDeps['isProcessGroupAlive']
  now?: () => number
}

/** Injected spawn, clock, timers, filesystem and streams: no process or browser is started. */
export function makeDeps(children: Child[], options: FakeOptions = {}) {
  const spawnCalls: Array<{ args: string[]; command: string; env: NodeJS.ProcessEnv }> = []
  const intervals: Array<{ callback: () => void }> = []
  const killed: Array<{ pid: number; signal: NodeJS.Signals }> = []
  const copied: Array<{ dest: string; src: string }> = []
  const dirs: string[] = []
  const removed: string[] = []
  const stderr: string[] = []
  const stdout: string[] = []
  const written: Array<{ content: string; path: string }> = []
  const live = new Set<number>()
  let index = 0
  const deps: StorybookBrowserRunnerDeps = {
    clearInterval: (timer) => {
      const at = intervals.indexOf(timer as never)
      if (at !== -1) intervals.splice(at, 1)
    },
    clearTimeout: () => undefined,
    cpSync: (src, dest) => void copied.push({ dest: String(dest), src: String(src) }),
    cwd: '/repo',
    existsSync: (path) => options.exists?.(String(path)) ?? false,
    isProcessGroupAlive: options.isProcessGroupAlive ?? ((pid) => live.has(pid)),
    killProcessGroup: (pid, signal) => {
      if (signal === 'SIGTERM') live.add(pid)
      killed.push({ pid, signal })
    },
    mkdirSync: (path) => (dirs.push(String(path)), undefined),
    now: options.now ?? (() => 0),
    offParentSignal: () => undefined,
    onParentSignal: () => undefined,
    rmSync: (path) => void removed.push(String(path)),
    setInterval: ((callback: () => void) => {
      const interval = { callback }
      intervals.push(interval)
      return interval
    }) as unknown as StorybookBrowserRunnerDeps['setInterval'],
    setTimeout: ((callback: () => void, delay = 0) => {
      if (delay <= 5000) callback()
      return { delay }
    }) as unknown as StorybookBrowserRunnerDeps['setTimeout'],
    spawn: ((command: string, args?: readonly string[], spawnOptions?: { env?: never }) => {
      const child = children[index++]
      if (!child) throw new Error('unexpected spawn')
      spawnCalls.push({ args: [...(args ?? [])], command, env: spawnOptions?.env ?? {} })
      return child
    }) as unknown as StorybookBrowserRunnerDeps['spawn'],
    stderr: { write: (chunk) => (stderr.push(String(chunk)), true) },
    stdout: { write: (chunk) => (stdout.push(String(chunk)), true) },
    waitForProcessGroupExit: async (pid) => void live.delete(pid),
    writeFileSync: (path, content) =>
      void written.push({
        content:
          typeof content === 'string' ? content : Buffer.from(content as Uint8Array).toString(),
        path: String(path),
      }),
  }
  return { copied, deps, dirs, intervals, killed, removed, spawnCalls, stderr, stdout, written }
}

export function exitChild(child: Child, code: number | null, signal: NodeJS.Signals | null = null) {
  child.emit('exit', code, signal)
  child.emit('close', code, signal)
}

export async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  expect(predicate()).toBe(true)
}

export const fetchFailure =
  'Failed to fetch dynamically imported module: http://localhost:47711/@id/__x00__virtual:/project-annotations.js'
export const runnerMissing =
  'Error: Failed to import test file /repo/node_modules/.pnpm/x/node_modules/@storybook/addon-vitest/dist/vitest-plugin/setup-file.js\n' +
  'Caused by: Error: Vitest failed to find the runner.\n' +
  'Test Files 149 failed\n'
export const progress = (sequence: number) =>
  `[vitest-browser-progress] seq=${sequence} event=module-start module="a.stories.tsx"\n`
