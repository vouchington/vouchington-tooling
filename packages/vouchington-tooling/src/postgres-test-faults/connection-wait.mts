import pg from 'pg'

export interface PostgresConnectionWaitPoolOptions {
  connectionString: string
  connectionTimeoutMillis: number
  max?: number
}

export interface TestPostgresConnectionWaitPool {
  queryProbe(): Promise<void>
  holdClient(): Promise<() => void>
  close(): Promise<void>
}

/** Real pg-pool connection waits for retry tests, without exposing raw SQL to the test. */
export function createTestPostgresConnectionWaitPool(
  options: PostgresConnectionWaitPoolOptions,
  PoolConstructor: new (config: pg.PoolConfig) => pg.Pool = pg.Pool,
): TestPostgresConnectionWaitPool {
  const pool = new PoolConstructor(options)
  return {
    queryProbe: async () => {
      await pool.query('/* createTestPostgresConnectionWaitPool */ SELECT 1')
    },
    holdClient: async () => {
      const client = await pool.connect()
      return () => client.release()
    },
    close: () => pool.end(),
  }
}
