import type pg from 'pg'
import type { createTestPostgresClientLoan, reserveTestPostgresObserver } from './client-loan.mts'
import type { getTestOwnedPostgresLock, TestOwnedPostgresWaitOptions } from './lock-identity.mts'

type Deferred<Value> = ReturnType<typeof Promise.withResolvers<Value>>
export type TestPostgresClientLoan = ReturnType<typeof createTestPostgresClientLoan>

export type TestPostgresMultiWaitState = {
  token: object
  options: TestOwnedPostgresWaitOptions
  started: Promise<void>
  observerLoan?: ReturnType<typeof reserveTestPostgresObserver>
  setup?: ReturnType<typeof getTestOwnedPostgresLock>
  pendingConnect?: Promise<pg.PoolClient>
  claimed?: boolean
  loan?: TestPostgresClientLoan
  operation?: Promise<unknown>
  witnessed: boolean
  cancelled: Deferred<never>
  captured: Deferred<TestPostgresClientLoan>
  holderRelease?: Promise<void>
  snapshot?: Promise<void>
}
