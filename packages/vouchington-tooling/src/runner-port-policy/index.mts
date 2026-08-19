import { readFileSync } from 'node:fs'
import type { Server } from 'node:net'

export interface RunnerPortPolicy {
  reservedPortStart: number
  reservedPortEnd: number
  portsPerRunner: number
  minimumRunnerSlot: number
  maximumRunnerSlot: number
}

const shippedPolicyUrl = new URL('runner-port-policy.json', import.meta.url)
const MAX_EPHEMERAL_BIND_ATTEMPTS = 100

type ListenOnHost = (server: Server, host: string) => Promise<void>

export interface EphemeralListenerOptions {
  isAllowedPort?: (port: number) => boolean
  listen?: ListenOnHost
  maxBindAttempts?: number
  policy?: RunnerPortPolicy
}

export class EphemeralListenerAttemptsExhaustedError extends Error {
  readonly maxBindAttempts: number

  constructor(maxBindAttempts: number) {
    super(
      `Failed to bind an allowed port outside the reserved runner range after ${maxBindAttempts} attempts`,
    )
    this.name = 'EphemeralListenerAttemptsExhaustedError'
    this.maxBindAttempts = maxBindAttempts
  }
}

export const runnerPortPolicy = loadRunnerPortPolicy()

export function isRunnerReservedPort(
  port: number,
  policy: RunnerPortPolicy = runnerPortPolicy,
): boolean {
  return port >= policy.reservedPortStart && port <= policy.reservedPortEnd
}

export async function listenOnRunnerUnreservedEphemeralPort(
  server: Server,
  host: string,
  options: EphemeralListenerOptions = {},
): Promise<number> {
  const policy = options.policy ?? runnerPortPolicy
  const maxBindAttempts = options.maxBindAttempts ?? MAX_EPHEMERAL_BIND_ATTEMPTS
  for (let attempt = 0; attempt < maxBindAttempts; attempt += 1) {
    await (options.listen ?? listenOnHost)(server, host)
    const port = getBoundPort(server)
    if (!isRunnerReservedPort(port, policy) && (options.isAllowedPort?.(port) ?? true)) {
      return port
    }
    await closeServer(server)
  }

  throw new EphemeralListenerAttemptsExhaustedError(maxBindAttempts)
}

export function loadRunnerPortPolicy(policyUrl: URL = shippedPolicyUrl): RunnerPortPolicy {
  return validateRunnerPortPolicy(JSON.parse(readFileSync(policyUrl, 'utf8')), policyUrl)
}

export function validateRunnerPortPolicy(parsedPolicy: unknown, policyUrl?: URL): RunnerPortPolicy {
  if (typeof parsedPolicy !== 'object' || parsedPolicy === null || Array.isArray(parsedPolicy)) {
    throwInvalidPolicy(policyUrl)
  }
  const policy = parsedPolicy as Record<string, unknown>
  const requiredKeys = [
    'reservedPortStart',
    'reservedPortEnd',
    'portsPerRunner',
    'minimumRunnerSlot',
    'maximumRunnerSlot',
  ] as const

  if (
    Object.keys(policy).length !== requiredKeys.length ||
    requiredKeys.some((key) => !Number.isInteger(policy[key]))
  ) {
    throwInvalidPolicy(policyUrl)
  }

  const validatedPolicy = policy as unknown as RunnerPortPolicy
  const {
    reservedPortStart: start,
    reservedPortEnd: end,
    portsPerRunner,
    minimumRunnerSlot,
    maximumRunnerSlot,
  } = validatedPolicy
  if (
    start < 1 ||
    end > 65_535 ||
    start > end ||
    portsPerRunner <= 0 ||
    minimumRunnerSlot !== 1 ||
    maximumRunnerSlot < minimumRunnerSlot ||
    end - start + 1 !== portsPerRunner * maximumRunnerSlot
  ) {
    throwInvalidPolicy(policyUrl)
  }

  return Object.freeze(validatedPolicy)
}

function throwInvalidPolicy(policyUrl?: URL): never {
  const location = policyUrl?.pathname ?? 'runner-port-policy'
  throw new Error(`Invalid CI runner port policy at ${location}`)
}

function listenOnHost(server: Server, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function getBoundPort(server: Server): number {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to allocate listener port')
  }
  return address.port
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
