import { vi } from 'vitest'
import {
  extractSqlStatement,
  type ManagedSqlTransaction,
  type SqlQueryResult,
  type SqlStatementInput,
  type TransactionBeginTarget,
} from './executor-faults.mts'

export type PoolQueryMethod = (
  input: SqlStatementInput,
  ...rest: unknown[]
) => Promise<SqlQueryResult>

export interface ReadQueryTarget {
  read: PoolQueryMethod
}

export interface WriteQueryTarget {
  write: PoolQueryMethod
}

/** Reject matching pool reads outside caller-owned transactions; returns the restore. */
export function rejectPostgresReadForTest(
  target: ReadQueryTarget,
  marker: string,
  error: unknown,
  onRejected: (values: readonly unknown[]) => void = () => {},
  matchesValues: (values: readonly unknown[]) => boolean = () => true,
): () => void {
  const realRead = target.read
  const spy = vi.spyOn(target, 'read').mockImplementation((query, ...rest) => {
    const { text, values } = extractSqlStatement(
      query,
      Array.isArray(rest[0]) ? (rest[0] as readonly unknown[]) : undefined,
    )
    if (!text.includes(marker) || !matchesValues(values)) {
      return Reflect.apply(realRead, target, [query, ...rest])
    }
    onRejected(values)
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Callers inject non-Error rejection values on purpose.
    return Promise.reject(error)
  })
  return () => spy.mockRestore()
}

/** Reject matching pool writes outside caller-owned transactions; returns the restore. */
export function rejectPostgresWriteForTest(
  target: WriteQueryTarget,
  marker: string,
  error: unknown,
  matchesValues: (values: readonly unknown[]) => boolean = () => true,
): () => void {
  const realWrite = target.write
  const spy = vi.spyOn(target, 'write').mockImplementation((query, ...rest) => {
    const { text, values } = extractSqlStatement(
      query,
      Array.isArray(rest[0]) ? (rest[0] as readonly unknown[]) : undefined,
    )
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Callers inject non-Error rejection values on purpose.
    if (text.includes(marker) && matchesValues(values)) return Promise.reject(error)
    return Reflect.apply(realWrite, target, [query, ...rest])
  })
  return () => spy.mockRestore()
}

/** Reject the next `beginTransaction()` call, then run normally; returns the restore. */
export function rejectNextPostgresTransactionForTest<
  Tx extends ManagedSqlTransaction,
  Options = unknown,
>(target: TransactionBeginTarget<Tx, Options>, error: Error): () => void {
  const spy = vi.spyOn(target, 'beginTransaction').mockRejectedValueOnce(error)
  return () => spy.mockRestore()
}

/** Answer matching pool reads in order; exhausted or undefined answers run for real. */
export function answerPostgresReadsForTest(
  target: ReadQueryTarget,
  marker: string,
  answers: ReadonlyArray<Record<string, unknown>[] | undefined>,
): () => void {
  const realRead = target.read
  let calls = 0
  const spy = vi.spyOn(target, 'read').mockImplementation((query, ...rest) => {
    const { text } = extractSqlStatement(query)
    if (!text.includes(marker)) return Reflect.apply(realRead, target, [query, ...rest])
    const rows = answers[calls++]
    if (!rows) return Reflect.apply(realRead, target, [query, ...rest])
    return Promise.resolve({ command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows })
  })
  return () => spy.mockRestore()
}

/** Answer matching pool writes in order; exhausted or undefined answers run for real. */
export function answerPostgresWritesForTest(
  target: WriteQueryTarget,
  marker: string,
  answers: ReadonlyArray<Record<string, unknown>[] | undefined>,
): () => void {
  const realWrite = target.write
  let calls = 0
  const spy = vi.spyOn(target, 'write').mockImplementation((query, ...rest) => {
    const { text } = extractSqlStatement(query)
    if (!text.includes(marker)) return Reflect.apply(realWrite, target, [query, ...rest])
    const rows = answers[calls++]
    if (!rows) return Reflect.apply(realWrite, target, [query, ...rest])
    return Promise.resolve({ command: 'UPDATE', rowCount: rows.length, oid: 0, fields: [], rows })
  })
  return () => spy.mockRestore()
}

/**
 * Run each pool write for real, then await `after` with its statement, values, and result. The
 * write resolves only after `after` settles, and a rejected `after` rejects the write.
 */
export function runAfterPostgresWriteForTest(
  target: WriteQueryTarget,
  after: (
    statement: string,
    values: readonly unknown[],
    result: { rowCount: number | null; rows: readonly Record<string, unknown>[] },
  ) => void | Promise<void>,
): () => void {
  const realWrite = target.write
  const spy = vi.spyOn(target, 'write').mockImplementation(async (query, ...rest) => {
    const result = await Reflect.apply(realWrite, target, [query, ...rest])
    const { text, values } = extractSqlStatement(
      query,
      Array.isArray(rest[0]) ? (rest[0] as readonly unknown[]) : undefined,
    )
    await after(text, values, result)
    return result
  })
  return () => spy.mockRestore()
}

/** Record each pool write whose SQL text contains `marker` while still executing it. */
export function observePostgresWritesForTest(
  target: WriteQueryTarget,
  marker: string,
): { writes: Promise<SqlQueryResult>[]; restore(): void } {
  const writes: Promise<SqlQueryResult>[] = []
  const realWrite = target.write
  const spy = vi.spyOn(target, 'write').mockImplementation((query, ...rest) => {
    const result = Reflect.apply(realWrite, target, [query, ...rest])
    const { text } = extractSqlStatement(query)
    if (text.includes(marker)) writes.push(result)
    return result
  })
  return { writes, restore: () => spy.mockRestore() }
}
