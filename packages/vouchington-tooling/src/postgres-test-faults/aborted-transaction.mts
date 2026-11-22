import type pg from 'pg'
import { hasErrorCode } from './fault-support.mts'

/**
 * Poisons the server transaction already begun on `client` with a real division by zero, so every
 * later statement on it is answered with `25P02`. Begin the transaction first, then call this, then
 * exercise code that borrows the client; roll the transaction back afterwards.
 */
export async function abortTestPostgresTransaction(
  client: Pick<pg.PoolClient, 'query'>,
): Promise<void> {
  try {
    await client.query('/* abortTestPostgresTransaction */ SELECT 1 / 0')
    throw new Error('PostgreSQL unexpectedly accepted division by zero')
  } catch (err) {
    if (!hasErrorCode(err, '22012')) throw err
  }
}
