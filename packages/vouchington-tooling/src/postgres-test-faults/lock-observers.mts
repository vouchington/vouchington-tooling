import type { LockObserverConfig, QueryExecutor } from './fault-types.mts'
import { getAdvisoryLockHolderProcessId, getTestPostgresBackendProcessId } from './lock-wait.mts'
import { waitForBlockedLockChain, waitForLockWaiter } from './lock-waiter.mts'

type ConfiguredWaiter = (
  ...args: Parameters<typeof waitForLockWaiter> extends [unknown, ...infer Rest] ? Rest : never
) => Promise<void>
type ConfiguredChain = (
  ...args: Parameters<typeof waitForBlockedLockChain> extends [unknown, ...infer Rest]
    ? Rest
    : never
) => Promise<void>

export type PostgresLockObservers = {
  getTestPostgresBackendProcessId: (query: QueryExecutor) => Promise<number>
  getTestPostgresAdvisoryLockHolderProcessId: (input: {
    key: string
    mode?: 'exclusive' | 'shared'
    namespace?: number
  }) => Promise<number>
  waitForTestPostgresLockWaiter: ConfiguredWaiter
  waitForTestPostgresBlockedLockChain: ConfiguredChain
}

/**
 * Binds the lock-wait observers to the executors and timings of one application. Call once in a
 * test setup module and re-export the functions.
 */
export function createPostgresLockObservers(config: LockObserverConfig): PostgresLockObservers {
  return {
    getTestPostgresBackendProcessId,
    getTestPostgresAdvisoryLockHolderProcessId: (input) =>
      getAdvisoryLockHolderProcessId(config, input),
    waitForTestPostgresLockWaiter: (...args) => waitForLockWaiter(config, ...args),
    waitForTestPostgresBlockedLockChain: (...args) => waitForBlockedLockChain(config, ...args),
  }
}
