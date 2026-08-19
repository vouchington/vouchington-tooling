import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptUrl = new URL('../../../scripts/host-lock/with-host-lock.sh', import.meta.url)

export type HostLockSpawn = (
  command: string,
  args: readonly string[],
  options: { stdio: 'inherit' },
) => Pick<SpawnSyncReturns<Buffer>, 'error' | 'status'>

export function hostLockScriptPath(): string {
  return fileURLToPath(scriptUrl)
}

export function runWithHostLock(args: readonly string[], spawn: HostLockSpawn = spawnSync): number {
  const result = spawn('bash', [hostLockScriptPath(), ...args], {
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  return result.status ?? 1
}
