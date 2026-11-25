import { vi } from 'vitest'
import {
  extractSqlStatement,
  type CallableSqlQueryExecutor,
  type ManagedSqlTransaction,
  type SqlQueryResult,
  type TransactionBeginTarget,
} from './executor-faults.mts'

/**
 * Wrap transactions opened through `target.beginTransaction` (only the next one when `once`)
 * with `wrap`; returns the restore function.
 */
export function interceptPostgresTransactionsForTest<
  Tx extends ManagedSqlTransaction,
  Options = unknown,
>(
  target: TransactionBeginTarget<Tx, Options>,
  wrap: (transaction: Tx) => Tx,
  once = false,
): () => void {
  const realBegin = Reflect.get(target, 'beginTransaction') as (options?: Options) => Promise<Tx>
  const spy = vi.spyOn(target, 'beginTransaction')
  const intercept = async (options?: Options) =>
    wrap(await Reflect.apply(realBegin, target, [options]))
  if (once) spy.mockImplementationOnce(intercept)
  else spy.mockImplementation(intercept)
  return () => spy.mockRestore()
}

/** Rewrite rows returned by matching transaction statements while still executing the SQL. */
export function rewritePostgresTransactionRowsForTest<
  Tx extends ManagedSqlTransaction,
  Options = unknown,
>(
  target: TransactionBeginTarget<Tx, Options>,
  marker: string,
  matchesValues: (values: readonly unknown[]) => boolean,
  rewrite: (rows: Record<string, unknown>[]) => Record<string, unknown>[],
): () => void {
  return interceptPostgresTransactionsForTest(
    target,
    (transaction) =>
      new Proxy(transaction, {
        async apply(fn, thisArgument, argumentsList: Parameters<CallableSqlQueryExecutor>) {
          const result = (await Reflect.apply(fn, thisArgument, argumentsList)) as SqlQueryResult
          const { text, values } = extractSqlStatement(argumentsList[0], argumentsList[1])
          if (!text.includes(marker) || !matchesValues(values)) return result
          const rows = rewrite(result.rows)
          return { ...result, rows, rowCount: rows.length }
        },
      }),
  )
}

/** Run `effect` right after the next transaction commits, then restore normal behavior. */
export function afterNextPostgresCommitForTest<Tx extends ManagedSqlTransaction, Options = unknown>(
  target: TransactionBeginTarget<Tx, Options>,
  effect: () => void,
): () => void {
  return interceptPostgresTransactionsForTest(
    target,
    (transaction) => {
      const commit = Reflect.get(transaction, 'commit') as () => Promise<void>
      transaction.commit = async () => {
        await Reflect.apply(commit, transaction, [])
        effect()
      }
      return transaction
    },
    true,
  )
}

/** Run a one-shot `effect` after a matching transaction query completes. */
export function afterPostgresTransactionQueryForTest<
  Tx extends ManagedSqlTransaction,
  Options = unknown,
>(
  target: TransactionBeginTarget<Tx, Options>,
  marker: string,
  matchesValues: (values: readonly unknown[]) => boolean,
  effect: (transaction: Tx) => Promise<void>,
): () => void {
  let applied = false
  return interceptPostgresTransactionsForTest(
    target,
    (transaction) =>
      new Proxy(transaction, {
        async apply(fn, thisArgument, argumentsList: Parameters<CallableSqlQueryExecutor>) {
          const result = (await Reflect.apply(fn, thisArgument, argumentsList)) as SqlQueryResult
          const { text, values } = extractSqlStatement(argumentsList[0], argumentsList[1])
          if (!applied && text.includes(marker) && matchesValues(values)) {
            applied = true
            await effect(fn)
          }
          return result
        },
      }),
  )
}

/** Run `intercept` before every transaction query matching `matches`, then run the query. */
export function interceptPostgresTransactionQueriesForTest<
  Tx extends ManagedSqlTransaction,
  Options = unknown,
>(
  target: TransactionBeginTarget<Tx, Options>,
  matches: (statement: string, values: readonly unknown[]) => boolean,
  intercept: (transaction: Tx) => Promise<void>,
): () => void {
  return interceptPostgresTransactionsForTest(
    target,
    (transaction) =>
      new Proxy(transaction, {
        apply(fn, thisArgument, argumentsList: Parameters<CallableSqlQueryExecutor>) {
          const { text, values } = extractSqlStatement(argumentsList[0], argumentsList[1])
          if (!matches(text, values)) return Reflect.apply(fn, thisArgument, argumentsList)
          return intercept(fn).then(() => Reflect.apply(fn, thisArgument, argumentsList))
        },
      }),
  )
}

/** Run a one-shot `effect` before a matching transaction statement executes. */
export function beforePostgresTransactionQueryForTest<
  Tx extends ManagedSqlTransaction,
  Options = unknown,
>(
  target: TransactionBeginTarget<Tx, Options>,
  marker: string,
  matchesValues: (values: readonly unknown[]) => boolean,
  effect: (transaction: Tx) => Promise<void>,
): () => void {
  let applied = false
  return interceptPostgresTransactionQueriesForTest(
    target,
    (text, values) => !applied && text.includes(marker) && matchesValues(values),
    async (transaction) => {
      applied = true
      await effect(transaction)
    },
  )
}
