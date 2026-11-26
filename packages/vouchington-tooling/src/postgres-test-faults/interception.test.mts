import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  afterNextPostgresCommitForTest,
  afterPostgresTransactionQueryForTest,
  answerPostgresReadsForTest,
  answerPostgresWritesForTest,
  beforePostgresTransactionQueryForTest,
  extractSqlStatement,
  interceptPostgresTransactionQueriesForTest,
  interceptPostgresTransactionsForTest,
  observePostgresWritesForTest,
  rejectNextPostgresTransactionForTest,
  rejectPostgresReadForTest,
  rejectPostgresWriteForTest,
  rejectQuery,
  rewritePostgresTransactionRowsForTest,
  runAfterPostgresWriteForTest,
  withFailingTransactionQueryOptionsForTest,
  withForcedTransactionRollbackForTest,
  withRejectedPostgresQueryForTest,
  type ManagedSqlTransaction,
  type SqlQueryResult,
  type SqlStatementInput,
} from './index.mts'

function createFakeTransaction(
  onQuery?: (text: string, values: readonly unknown[]) => SqlQueryResult,
) {
  let committed = false
  let disposed = false
  const executor = (async (input: SqlStatementInput, values?: readonly unknown[]) => {
    const parsed = extractSqlStatement(input, values)
    return (
      onQuery?.(parsed.text, parsed.values) ?? {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ text: parsed.text, values: parsed.values }],
      }
    )
  }) as unknown as ManagedSqlTransaction & { committed: () => boolean; disposed: () => boolean }

  executor.commit = async () => {
    committed = true
  }
  executor[Symbol.asyncDispose] = async () => {
    disposed = true
  }
  executor.committed = () => committed
  executor.disposed = () => disposed
  return executor
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('transaction interception helpers', () => {
  it('extracts statement text and values from strings and objects', () => {
    expect(extractSqlStatement('SELECT 1')).toEqual({ text: 'SELECT 1', values: [] })
    expect(extractSqlStatement('SELECT $1', ['a'])).toEqual({ text: 'SELECT $1', values: ['a'] })
    expect(extractSqlStatement({ text: 'SELECT 2' })).toEqual({ text: 'SELECT 2', values: [] })
    expect(extractSqlStatement({ text: 'SELECT $1', values: ['b'] })).toEqual({
      text: 'SELECT $1',
      values: ['b'],
    })
  })

  it('rejects matching queries on direct executors and inside transaction wrappers', async () => {
    const tx = createFakeTransaction()
    const wrappedString = rejectQuery(tx, (sql) => sql.includes('/* bad */'), 'boom')
    expect(() => wrappedString('/* bad */ SELECT 1')).toThrow('boom')
    await expect(wrappedString('/* ok */ SELECT 1')).resolves.toMatchObject({ rowCount: 1 })

    const customError = new Error('custom')
    const wrappedErr = rejectQuery(tx, (_sql, values) => values[0] === 'x', customError)
    expect(() => wrappedErr({ text: 'SELECT $1', values: ['x'] })).toThrow(customError)

    await expect(
      withRejectedPostgresQueryForTest(
        async () => createFakeTransaction(),
        (sql) => sql.includes('/* fail */'),
        'rejected tx query',
        async (query) => {
          await query('/* fail */ UPDATE t SET x = 1')
        },
      ),
    ).rejects.toThrow('rejected tx query')

    const rollbackTx = createFakeTransaction()
    await expect(
      withForcedTransactionRollbackForTest(
        async () => rollbackTx,
        async ({ query }) => {
          await query('SELECT 1')
        },
      ),
    ).rejects.toThrow('Injected transaction rollback for test')
    expect(rollbackTx.committed()).toBe(false)
    expect(rollbackTx.disposed()).toBe(true)

    const okTx = createFakeTransaction()
    await expect(
      withFailingTransactionQueryOptionsForTest(
        async () => okTx,
        'my:step',
        async ({ query }) => {
          await query('/* other */ SELECT 1')
          return 'ok'
        },
      ),
    ).resolves.toBe('ok')
    expect(okTx.committed()).toBe(true)

    await expect(
      withFailingTransactionQueryOptionsForTest(
        async () => createFakeTransaction(),
        'my:step',
        async ({ query }) => {
          await query('/* my:step */ UPDATE t SET x = 1')
        },
      ),
    ).rejects.toThrow('Injected query failure for my:step')
  })

  it('intercepts transactions (once and persistent), rewrites rows, and runs commit/before/after hooks', async () => {
    const target = {
      beginTransaction: async () => createFakeTransaction(),
    }

    // once=true wraps only first transaction.
    let wraps = 0
    const restoreOnce = interceptPostgresTransactionsForTest(
      target,
      (tx) => {
        wraps += 1
        return tx
      },
      true,
    )
    await target.beginTransaction()
    await target.beginTransaction()
    expect(wraps).toBe(1)
    restoreOnce()

    // rewritePostgresTransactionRowsForTest
    const restoreRewrite = rewritePostgresTransactionRowsForTest(
      target,
      '/* rewrite */',
      (values) => values[0] === 'match',
      () => [{ rewritten: true }, { rewritten: false }],
    )
    const tx1 = await target.beginTransaction()
    expect(await tx1('/* rewrite */ SELECT $1', ['match'])).toMatchObject({
      rowCount: 2,
      rows: [{ rewritten: true }, { rewritten: false }],
    })
    expect(await tx1('/* rewrite */ SELECT $1', ['other'])).toMatchObject({ rowCount: 1 })
    restoreRewrite()

    // afterNextPostgresCommitForTest
    const events: string[] = []
    const restoreCommit = afterNextPostgresCommitForTest(target, () => events.push('after-commit'))
    const tx2 = await target.beginTransaction()
    await tx2.commit()
    expect(tx2.committed()).toBe(true)
    expect(events).toEqual(['after-commit'])
    restoreCommit()

    // afterPostgresTransactionQueryForTest (one-shot)
    const restoreAfter = afterPostgresTransactionQueryForTest(
      target,
      '/* after */',
      (values) => values[0] === 1,
      async () => {
        events.push('after-query')
      },
    )
    const tx3 = await target.beginTransaction()
    await tx3('/* after */ SELECT $1', [2])
    await tx3('/* after */ SELECT $1', [1])
    await tx3('/* after */ SELECT $1', [1])
    expect(events).toEqual(['after-commit', 'after-query'])
    restoreAfter()

    // beforePostgresTransactionQueryForTest (one-shot) & interceptPostgresTransactionQueriesForTest
    const restoreBefore = beforePostgresTransactionQueryForTest(
      target,
      '/* before */',
      (values) => values[0] === 'go',
      async () => {
        events.push('before-query')
      },
    )
    const tx4 = await target.beginTransaction()
    await tx4('/* before */ SELECT $1', ['skip'])
    await tx4('/* before */ SELECT $1', ['go'])
    await tx4('/* before */ SELECT $1', ['go'])
    expect(events).toEqual(['after-commit', 'after-query', 'before-query'])
    restoreBefore()

    let intercepted = 0
    const restoreAll = interceptPostgresTransactionQueriesForTest(
      target,
      (sql) => sql.includes('/* every */'),
      async () => {
        intercepted += 1
      },
    )
    const tx5 = await target.beginTransaction()
    await tx5('/* every */ SELECT 1')
    await tx5('/* every */ SELECT 2')
    expect(intercepted).toBe(2)
    restoreAll()
  })
})

describe('query interception helpers', () => {
  it('rejects, answers, runs after-hooks, and observes pool reads, writes, and transactions', async () => {
    const target = {
      read: async (input: SqlStatementInput, ...rest: unknown[]): Promise<SqlQueryResult> => {
        const { text, values } = extractSqlStatement(
          input,
          Array.isArray(rest[0]) ? (rest[0] as readonly unknown[]) : undefined,
        )
        return {
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
          rows: [{ kind: 'read', text, values }],
        }
      },
      write: async (input: SqlStatementInput, ...rest: unknown[]): Promise<SqlQueryResult> => {
        const { text, values } = extractSqlStatement(
          input,
          Array.isArray(rest[0]) ? (rest[0] as readonly unknown[]) : undefined,
        )
        return {
          command: 'UPDATE',
          rowCount: 1,
          oid: 0,
          fields: [],
          rows: [{ kind: 'write', text, values }],
        }
      },
      beginTransaction: async () => createFakeTransaction(),
    }

    // rejectPostgresReadForTest (default callbacks + custom)
    const rejectedValues: unknown[] = []
    const restoreReadReject = rejectPostgresReadForTest(
      target,
      '/* r */',
      'read-err',
      (values) => rejectedValues.push(values),
      (values) => values[0] === 'hit',
    )
    await expect(target.read('/* r */ SELECT $1', ['hit'])).rejects.toBe('read-err')
    await expect(target.read('/* r */ SELECT $1', ['miss'])).resolves.toMatchObject({ rowCount: 1 })
    await expect(target.read({ text: '/* other */ SELECT 1' })).resolves.toMatchObject({
      rowCount: 1,
    })
    expect(rejectedValues).toEqual([['hit']])
    restoreReadReject()

    const restoreDefaultReadReject = rejectPostgresReadForTest(target, '/* r2 */', new Error('r2'))
    await expect(target.read('/* r2 */ SELECT 1')).rejects.toThrow('r2')
    restoreDefaultReadReject()

    // rejectPostgresWriteForTest
    const restoreWriteReject = rejectPostgresWriteForTest(
      target,
      '/* w */',
      'write-err',
      (values) => values[0] === 'hit',
    )
    await expect(target.write('/* w */ UPDATE t', ['hit'])).rejects.toBe('write-err')
    await expect(
      target.write({ text: '/* w */ UPDATE t', values: ['miss'] }),
    ).resolves.toMatchObject({
      rowCount: 1,
    })
    restoreWriteReject()

    const restoreDefaultWriteReject = rejectPostgresWriteForTest(
      target,
      '/* w2 */',
      new Error('w2'),
    )
    await expect(target.write('/* w2 */ UPDATE t')).rejects.toThrow('w2')
    restoreDefaultWriteReject()

    // rejectNextPostgresTransactionForTest
    const restoreNextTx = rejectNextPostgresTransactionForTest(target, new Error('tx-fail'))
    await expect(target.beginTransaction()).rejects.toThrow('tx-fail')
    await expect(target.beginTransaction()).resolves.toBeDefined()
    restoreNextTx()

    // answerPostgresReadsForTest
    const restoreAnswerReads = answerPostgresReadsForTest(target, '/* ar */', [
      [{ a: 1 }],
      undefined,
    ])
    expect(await target.read('/* ar */ SELECT 1')).toMatchObject({ rows: [{ a: 1 }] })
    expect(await target.read('/* ar */ SELECT 2')).toMatchObject({
      rows: [{ kind: 'read', text: '/* ar */ SELECT 2' }],
    })
    expect(await target.read('/* other */ SELECT 3')).toMatchObject({
      rows: [{ kind: 'read', text: '/* other */ SELECT 3' }],
    })
    restoreAnswerReads()

    // answerPostgresWritesForTest
    const restoreAnswerWrites = answerPostgresWritesForTest(target, '/* aw */', [
      [{ b: 2 }],
      undefined,
    ])
    expect(await target.write('/* aw */ UPDATE 1')).toMatchObject({ rows: [{ b: 2 }] })
    expect(await target.write('/* aw */ UPDATE 2')).toMatchObject({
      rows: [{ kind: 'write', text: '/* aw */ UPDATE 2' }],
    })
    expect(await target.write('/* other */ UPDATE 3')).toMatchObject({
      rows: [{ kind: 'write', text: '/* other */ UPDATE 3' }],
    })
    restoreAnswerWrites()

    // runAfterPostgresWriteForTest
    const afterLog: Array<{
      statement: string
      values: readonly unknown[]
      rowCount: number | null
    }> = []
    const restoreAfterWrite = runAfterPostgresWriteForTest(target, (statement, values, result) => {
      afterLog.push({ statement, values, rowCount: result.rowCount })
    })
    await target.write('UPDATE a', [1])
    await target.write({ text: 'UPDATE b', values: [2] })
    expect(afterLog).toEqual([
      { statement: 'UPDATE a', values: [1], rowCount: 1 },
      { statement: 'UPDATE b', values: [2], rowCount: 1 },
    ])
    restoreAfterWrite()

    // runAfterPostgresWriteForTest awaits an async `after` before the write resolves
    const asyncEvents: string[] = []
    const restoreAsyncAfter = runAfterPostgresWriteForTest(target, async (statement) => {
      await new Promise<void>((resolve) => setImmediate(resolve))
      asyncEvents.push(`after ${statement}`)
    })
    await target.write('UPDATE async')
    asyncEvents.push('write resolved')
    expect(asyncEvents).toEqual(['after UPDATE async', 'write resolved'])
    restoreAsyncAfter()

    // runAfterPostgresWriteForTest rejects the write when `after` rejects
    const afterError = new Error('after failed')
    const restoreRejectingAfter = runAfterPostgresWriteForTest(target, async () => {
      throw afterError
    })
    await expect(target.write('UPDATE rejected')).rejects.toBe(afterError)
    restoreRejectingAfter()

    // observePostgresWritesForTest
    const observed = observePostgresWritesForTest(target, '/* obs */')
    await target.write('/* obs */ INSERT 1')
    await target.write('/* skip */ INSERT 2')
    expect(observed.writes).toHaveLength(1)
    expect(await observed.writes[0]).toMatchObject({
      rows: [{ kind: 'write', text: '/* obs */ INSERT 1' }],
    })
    observed.restore()
  })
})
