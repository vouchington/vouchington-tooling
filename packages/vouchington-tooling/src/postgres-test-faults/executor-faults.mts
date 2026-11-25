export type SqlStatementInput =
  | string
  | {
      text: string
      values?: readonly unknown[]
    }

export type SqlQueryResult<Row extends object = Record<string, unknown>> = {
  command?: string
  rowCount: number | null
  oid?: number
  fields?: readonly unknown[]
  rows: Row[]
}

export type CallableSqlQueryExecutor = <Row extends object = Record<string, unknown>>(
  input: SqlStatementInput,
  values?: readonly unknown[],
) => Promise<SqlQueryResult<Row>>

export type ManagedSqlTransaction = CallableSqlQueryExecutor & {
  commit(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
  client?: unknown
}

export interface TransactionBeginTarget<
  Tx extends ManagedSqlTransaction = ManagedSqlTransaction,
  Options = unknown,
> {
  beginTransaction(options?: Options): Promise<Tx>
}

export function extractSqlStatement(
  input: SqlStatementInput,
  parameters?: readonly unknown[],
): { text: string; values: readonly unknown[] } {
  if (typeof input === 'string') {
    return { text: input, values: Array.isArray(parameters) ? parameters : [] }
  }
  return { text: input.text, values: input.values ?? [] }
}

/** Reject one query made through a caller-owned executor while preserving its transaction. */
export function rejectQuery<Query extends CallableSqlQueryExecutor>(
  query: Query,
  matches: (statement: string, values: readonly unknown[]) => boolean,
  message: string | Error,
): Query {
  return new Proxy(query, {
    apply(target, thisArgument, argumentsList: Parameters<CallableSqlQueryExecutor>) {
      const { text, values } = extractSqlStatement(argumentsList[0], argumentsList[1])
      if (matches(text, values)) {
        throw typeof message === 'string' ? new Error(message) : message
      }
      return Reflect.apply(target, thisArgument, argumentsList)
    },
  })
}

/** Inject one write failure through a caller-owned real PostgreSQL transaction. */
export async function withRejectedPostgresQueryForTest<Tx extends ManagedSqlTransaction, Result>(
  beginTransaction: () => Promise<Tx>,
  matches: (statement: string, values: readonly unknown[]) => boolean,
  message: string | Error,
  operation: (query: Tx) => Promise<Result>,
): Promise<Result> {
  await using transaction = await beginTransaction()
  return await operation(rejectQuery(transaction, matches, message))
}

/** Run `handler` inside a real transaction and force a rollback after it finishes. */
export async function withForcedTransactionRollbackForTest<Tx extends ManagedSqlTransaction>(
  beginTransaction: () => Promise<Tx>,
  handler: (options: { query: Tx }) => Promise<unknown>,
): Promise<never> {
  await using transaction = await beginTransaction()
  await handler({ query: transaction })
  throw new Error('Injected transaction rollback for test')
}

/** Fail a transaction query whose SQL contains `/* <annotation> *\/`, otherwise commit. */
export async function withFailingTransactionQueryOptionsForTest<
  Tx extends ManagedSqlTransaction,
  Result,
>(
  beginTransaction: () => Promise<Tx>,
  annotation: string,
  handler: (options: { query: Tx }) => Promise<Result>,
): Promise<Result> {
  await using transaction = await beginTransaction()
  const failingQuery = rejectQuery(
    transaction,
    (text) => text.includes(`/* ${annotation} */`),
    `Injected query failure for ${annotation}`,
  )
  const result = await handler({ query: failingQuery })
  await transaction.commit()
  return result
}
