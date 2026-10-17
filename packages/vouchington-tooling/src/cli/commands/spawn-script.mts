import { spawnSync, type SpawnSyncReturns } from 'node:child_process'

export type ScriptSpawn = (
  command: string,
  args: readonly string[],
  options: { stdio: 'inherit' },
) => Pick<SpawnSyncReturns<Buffer>, 'error' | 'status'>

export function runScript(
  command: string,
  scriptPath: string,
  args: readonly string[],
  spawn: ScriptSpawn = spawnSync,
): number {
  const result = spawn(command, [scriptPath, ...args], { stdio: 'inherit' })
  if (result.error) throw result.error
  return result.status ?? 1
}
