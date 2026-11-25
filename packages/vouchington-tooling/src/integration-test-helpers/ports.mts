import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import { listenOnRunnerUnreservedEphemeralPort } from '../runner-port-policy/index.mts'
import { isFetchSafePort } from './fetch-ports.mts'

const LOWEST_UNPRIVILEGED_PORT = 1024
const HIGHEST_PORT = 65535

export interface ReservedPort {
  port: number
  release: () => Promise<void>
}

export type ReservePorts = (count: number) => Promise<ReservedPort[]>
export type ListenOnLoopback = (server: net.Server, port: number) => Promise<void>

/** Reserves `count` Fetch-safe loopback ports outside the kernel ephemeral range. */
export async function allocateReservedPorts(
  count: number,
  reservePorts: ReservePorts = reserveLoopbackPorts,
): Promise<ReservedPort[]> {
  const reservations: ReservedPort[] = []
  try {
    while (reservations.length < count) {
      // oxlint-disable-next-line no-await-in-loop -- hold safe reservations while replacing forbidden ones
      const candidates = await reservePorts(count - reservations.length)
      const forbiddenCandidates: ReservedPort[] = []
      for (const candidate of candidates) {
        if (isFetchSafePort(candidate.port)) {
          reservations.push(candidate)
        } else {
          forbiddenCandidates.push(candidate)
        }
      }
      // oxlint-disable-next-line no-await-in-loop -- close forbidden candidates before allocating replacements
      const releaseResults = await Promise.allSettled(
        forbiddenCandidates.map((candidate) => candidate.release()),
      )
      const failedRelease = releaseResults.find((result) => result.status === 'rejected')
      if (failedRelease) {
        throw failedRelease.reason
      }
    }

    return reservations
  } catch (err) {
    await Promise.allSettled(reservations.map((reservation) => reservation.release()))
    throw err
  }
}

/** Binds `server` on `127.0.0.1` to an ephemeral port that is both runner-unreserved and Fetch-safe. */
export async function listenOnFetchSafeEphemeralPort(
  server: net.Server,
  listen: ListenOnLoopback = listenOnLoopback,
): Promise<number> {
  return listenOnRunnerUnreservedEphemeralPort(server, '127.0.0.1', {
    isAllowedPort: isFetchSafePort,
    listen: async (candidate) => listen(candidate, 0),
  })
}

/** Binds `server` on `127.0.0.1` to a Fetch-safe ephemeral port and returns its `http://127.0.0.1:<port>` origin. */
export async function listenOnFetchSafeLoopback(
  server: net.Server,
  listen: ListenOnLoopback = listenOnLoopback,
): Promise<string> {
  const port = await listenOnFetchSafeEphemeralPort(server, listen)
  return `http://127.0.0.1:${port}`
}

export interface ServicePortBandRange {
  first: number
  last: number
}

export function servicePortBand(range: ServicePortBandRange): { start: number; end: number } {
  if (range.first > LOWEST_UNPRIVILEGED_PORT) {
    return { start: LOWEST_UNPRIVILEGED_PORT, end: range.first - 1 }
  }
  if (range.last < HIGHEST_PORT) {
    return { start: range.last + 1, end: HIGHEST_PORT }
  }
  throw new Error(
    `Kernel ephemeral port range ${range.first}-${range.last} covers every unprivileged port`,
  )
}

export function readKernelEphemeralPortRange(
  deps: {
    platform?: NodeJS.Platform
    readFile?: (path: string, encoding: 'utf8') => string
    execFile?: (command: string, args: string[], options: { encoding: 'utf8' }) => string
  } = {},
): ServicePortBandRange {
  const platform = deps.platform ?? process.platform
  if (platform === 'linux') {
    const text = (deps.readFile ?? readFileSync)(
      '/proc/sys/net/ipv4/ip_local_port_range',
      'utf8',
    ).trim()
    const match = /^(\d+)\s+(\d+)$/.exec(text)
    if (!match) throw new Error(`Unreadable kernel ephemeral port range: ${text}`)
    return { first: Number(match[1]), last: Number(match[2]) }
  }
  if (platform === 'darwin') {
    const exec = deps.execFile ?? execFileSync
    return {
      first: readDarwinPortRange('net.inet.ip.portrange.first', exec),
      last: readDarwinPortRange('net.inet.ip.portrange.last', exec),
    }
  }
  throw new Error(`Cannot read the kernel ephemeral port range on ${platform}`)
}

function readDarwinPortRange(
  name: string,
  exec: (command: string, args: string[], options: { encoding: 'utf8' }) => string,
): number {
  const value = Number(exec('sysctl', ['-n', name], { encoding: 'utf8' }).trim())
  if (!Number.isInteger(value)) throw new Error(`Unreadable Darwin port range ${name}`)
  return value
}

export async function reserveLoopbackPorts(
  count: number,
  deps: {
    createServer?: () => net.Server
    readRange?: () => ServicePortBandRange
  } = {},
): Promise<ReservedPort[]> {
  const band = servicePortBand((deps.readRange ?? readKernelEphemeralPortRange)())
  const servers: net.Server[] = []
  const bandSize = band.end - band.start + 1
  const startOffset = randomInt(bandSize)
  const makeServer = deps.createServer ?? net.createServer
  try {
    for (let offset = 0; servers.length < count && offset < bandSize; offset += 1) {
      const candidate = band.start + ((startOffset + offset) % bandSize)
      if (!isFetchSafePort(candidate)) continue
      // oxlint-disable-next-line no-await-in-loop -- a failed bind must settle before trying the next port
      const server = await tryReserveLoopback(candidate, makeServer)
      if (server) servers.push(server)
    }
  } catch (err) {
    await Promise.allSettled(servers.map(closeServer))
    throw err
  }
  if (servers.length < count) {
    await Promise.allSettled(servers.map(closeServer))
    throw new Error(`Failed to reserve ${count} service ports outside the kernel ephemeral range`)
  }
  return servers.map(toReservedPort)
}

async function tryReserveLoopback(
  port: number,
  makeServer: () => net.Server,
): Promise<net.Server | null> {
  const server = makeServer()
  try {
    await listenOnLoopback(server, port)
    return server
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EADDRINUSE') return null
    throw err
  }
}

function toReservedPort(server: net.Server): ReservedPort {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to allocate port')
  return { port: address.port, release: () => closeServer(server) }
}

function listenOnLoopback(server: net.Server, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
