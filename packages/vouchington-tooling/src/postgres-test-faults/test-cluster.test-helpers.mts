import { execFileSync } from 'node:child_process'
import { existsSync, globSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import pg from 'pg'

export type TestCluster = {
  /** Opens a pool against the throwaway cluster. */
  createPool: (max?: number) => pg.Pool
  stop: () => Promise<void>
}

function findPostgresBinDir(): string | undefined {
  return [
    process.env.POSTGRES_BIN_DIR ?? '',
    ...(process.env.PATH ?? '').split(delimiter),
    ...globSync('/usr/lib/postgresql/*/bin'),
    ...globSync('/opt/homebrew/opt/postgresql@*/bin'),
    ...globSync('/usr/local/opt/postgresql@*/bin'),
  ].find((dir) => dir && existsSync(join(dir, 'initdb')) && existsSync(join(dir, 'pg_ctl')))
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function startTestCluster(binDir: string): Promise<TestCluster> {
  const dir = mkdtempSync(join(tmpdir(), 'pg-faults-'))
  const run = (bin: string, args: string[]) =>
    execFileSync(join(binDir, bin), args, { stdio: 'pipe' })
  try {
    const port = await freePort()
    run('initdb', ['-D', dir, '-U', 'postgres', '--auth=trust', '--no-sync'])
    run('pg_ctl', [
      '-D',
      dir,
      '-w',
      '-o',
      `-p ${port} -h 127.0.0.1 -c fsync=off -c unix_socket_directories=${dir}`,
      '-l',
      join(dir, 'server.log'),
      'start',
    ])
    const pools = new Set<pg.Pool>()
    return {
      createPool: (max = 4) => {
        const pool = new pg.Pool({
          host: '127.0.0.1',
          port,
          user: 'postgres',
          database: 'postgres',
          max,
        })
        pools.add(pool)
        return pool
      },
      stop: async () => {
        await Promise.allSettled([...pools].map((pool) => pool.end()))
        run('pg_ctl', ['-D', dir, '-m', 'immediate', '-w', 'stop'])
        rmSync(dir, { recursive: true, force: true })
      },
    }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

/**
 * Starts a throwaway PostgreSQL cluster (binaries from `POSTGRES_BIN_DIR`, `PATH` or a standard
 * install location). Returns undefined when no server can run here, for example inside a sandbox
 * that forbids shared memory, so the real-database suites skip. Under CI that is a failure
 * instead, so the real-database tests cannot be silently skipped there.
 */
export async function tryStartTestCluster(): Promise<TestCluster | undefined> {
  try {
    const binDir = findPostgresBinDir()
    if (!binDir) throw new Error('PostgreSQL binaries (initdb, pg_ctl) were not found')
    return await startTestCluster(binDir)
  } catch (err) {
    if (process.env.CI) throw err
    console.warn(`Skipping real PostgreSQL tests: ${(err as Error).message.split('\n')[0]}`)
    return undefined
  }
}
