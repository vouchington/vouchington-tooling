/* oxlint-disable typescript/unbound-method -- the original pool and client methods are captured to be re-applied with Reflect.apply */
import type { AsyncLocalStorage } from 'node:async_hooks'
import type pg from 'pg'
import { createTestPostgresClientLoan, discardTestPostgresClient } from './client-loan.mts'
import type { TestHeldPostgresLock } from './lock-identity.mts'
import type { LockNoticeOptions } from './lock-notice.mts'

type Loan = ReturnType<typeof createTestPostgresClientLoan>
type ConnectCallback = (
  err?: Error,
  client?: pg.PoolClient,
  release?: pg.PoolClient['release'],
) => void

/** Captures every owned pool lease, including the callback lease used by `Pool#query`. */
export function installTestOwnedPostgresPoolProxy(input: {
  pool: pg.Pool
  actionScope: AsyncLocalStorage<object>
  token: object
  requestId?: string | undefined
  isOwnedRequest?: ((requestId: string) => boolean) | undefined
  notice?: LockNoticeOptions | undefined
  requireOpen: () => void
  isClosed: () => boolean
  closedReason: Error
  targetLock: TestHeldPostgresLock
  operationRegistered: Promise<{ outcome: Promise<PromiseSettledResult<unknown>[]> }>
  captured: ReturnType<typeof Promise.withResolvers<Loan>>
  pendingConnects: Promise<pg.PoolClient>[]
  loans: Loan[]
}): () => void {
  const { pool } = input
  const descriptor = Object.getOwnPropertyDescriptor(pool, 'connect')
  const original = pool.connect
  const prepareLoan = async (client: pg.PoolClient): Promise<pg.PoolClient> => {
    if (input.isClosed()) {
      await discardTestPostgresClient(client)
      throw input.closedReason
    }
    let loan: Loan | undefined
    try {
      loan = createTestPostgresClientLoan(client, input.targetLock, input.notice)
      input.loans.push(loan)
      await loan.ready
      input.requireOpen()
    } catch (err) {
      try {
        if (loan) await loan.dispose()
        else await discardTestPostgresClient(client)
      } catch (cleanupErr) {
        throw new AggregateError([err, cleanupErr], 'Owned PostgreSQL loan setup failed', {
          cause: cleanupErr,
        })
      }
      throw err
    }
    void input.operationRegistered
      .then(({ outcome }) => loan.wait(outcome))
      .then(() => input.captured.resolve(loan))
      .catch(input.captured.reject)
    return client
  }
  async function completeCallbackLoan(client: pg.PoolClient, callback: ConnectCallback) {
    let readyClient: pg.PoolClient
    try {
      const pendingConnect = prepareLoan(client)
      input.pendingConnects.push(pendingConnect)
      readyClient = await pendingConnect
    } catch (err) {
      input.captured.reject(err)
      try {
        callback(err as Error)
      } catch (callbackErr) {
        input.captured.reject(callbackErr)
      }
      return
    }
    try {
      callback(undefined, readyClient, readyClient.release)
    } catch (err) {
      input.captured.reject(err)
    }
  }
  Object.defineProperty(pool, 'connect', {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    writable: true,
    value: new Proxy(original, {
      apply(target, receiver, args) {
        const owned =
          input.actionScope.getStore() === input.token ||
          (input.requestId !== undefined && input.isOwnedRequest?.(input.requestId) === true)
        if (!owned) return Reflect.apply(target, receiver, args)
        input.requireOpen()
        if (typeof args[0] === 'function') {
          const callback = args[0] as ConnectCallback
          return Reflect.apply(target, receiver, [
            (err?: Error, client?: pg.PoolClient, release?: pg.PoolClient['release']) => {
              if (err || !client) return callback(err, client, release)
              void completeCallbackLoan(client, callback)
            },
          ])
        }
        const pendingConnect = (
          Reflect.apply(target, receiver, args) as Promise<pg.PoolClient>
        ).then(prepareLoan)
        input.pendingConnects.push(pendingConnect)
        void pendingConnect.catch(input.captured.reject)
        return pendingConnect
      },
    }),
  })
  return () => {
    if (descriptor) Object.defineProperty(pool, 'connect', descriptor)
    else Reflect.deleteProperty(pool, 'connect')
  }
}
