import type { spawn as defaultSpawn } from 'node:child_process'
import type { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'

import type {
  BrowserSessionDeps,
  isProcessGroupAlive,
  waitForProcessGroupExit,
} from '../browser-session-runner/index.mts'

/** Repository-specific values the runner takes as parameters. */
export type StorybookBrowserProject = {
  /** Base argv after `command`. Defaults to `exec vitest run --project <projectName>`. */
  args?: readonly string[]
  /** Appended to the argv unless `<envPrefix>_COVERAGE` is `0`. Defaults to `--coverage`. */
  coverageArgs?: readonly string[]
  /** Command to spawn. Defaults to `pnpm`. */
  command?: string
  /** Result file, relative to the working directory, whose appearance marks completion. */
  completionFile?: string
  /** Prefix of the tunable env var names. Defaults to `STORYBOOK_BROWSER`. */
  envPrefix?: string
  /** Config path named in the guidance printed when Vite discovers new optimizeDeps. */
  optimizeDepsConfigPath?: string
  /** Progress marker prefix emitted by the Storybook progress reporter. */
  progressPrefix?: string
  /** Vitest project name, also the browser-project output marker. */
  projectName: string
  /** Files, relative to the working directory, removed before each attempt. */
  resultFiles?: readonly string[]
}

export type ResolvedStorybookBrowserProject = Required<
  Omit<StorybookBrowserProject, 'completionFile' | 'optimizeDepsConfigPath'>
> & {
  completionFile: string | undefined
  optimizeDepsGuidance: string
}

export type StorybookBrowserRunnerDeps = {
  clearInterval: typeof clearInterval
  clearTimeout: typeof clearTimeout
  cpSync: typeof cpSync
  cwd: string
  existsSync: typeof existsSync
  isProcessGroupAlive: typeof isProcessGroupAlive
  killProcessGroup: (pid: number, signal: NodeJS.Signals) => void
  mkdirSync: typeof mkdirSync
  now: () => number
  offParentSignal: BrowserSessionDeps['offParentSignal']
  onParentSignal: BrowserSessionDeps['onParentSignal']
  rmSync: typeof rmSync
  setInterval: typeof setInterval
  setTimeout: typeof setTimeout
  spawn: typeof defaultSpawn
  stderr: Pick<NodeJS.WriteStream, 'write'>
  stdout: Pick<NodeJS.WriteStream, 'write'>
  waitForProcessGroupExit: typeof waitForProcessGroupExit
  writeFileSync: typeof writeFileSync
}
