import { spawnSync, type SpawnSyncReturns } from 'node:child_process'

import { ghSpawnEnv } from '../../gh-cli/env.mts'

export type ScriptSpawn = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; stdio: 'inherit' },
) => Pick<SpawnSyncReturns<Buffer>, 'error' | 'status'>

/** Runs a packaged script; several call `gh --json`, so `CLICOLOR_FORCE` is dropped from its env. */
export function runScript(
  command: string,
  scriptPath: string,
  args: readonly string[],
  spawn: ScriptSpawn = spawnSync,
): number {
  const result = spawn(command, [scriptPath, ...args], { env: ghSpawnEnv(), stdio: 'inherit' })
  if (result.error) throw result.error
  return result.status ?? 1
}
