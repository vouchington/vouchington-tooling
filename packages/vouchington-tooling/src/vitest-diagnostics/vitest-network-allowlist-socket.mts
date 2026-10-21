import type { DnsFn } from './vitest-network-allowlist-dns.mts'
import { normalizeHost } from './vitest-network-allowlist-host.mts'

export type NetModule = {
  isIP: (host: string) => number
  Socket: { prototype: { connect: DnsFn } }
}

type ConnectTarget = { host: string | null; options: Record<string, unknown> | null }

export type SocketAllowlistHooks = {
  isAllowedHost: (host: string) => boolean
  blockConnection: (host: string) => Error
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function connectHost(args: unknown[]): ConnectTarget {
  const list = Array.isArray(args[0]) ? (args[0] as unknown[]) : args
  const first = list[0]
  if (typeof first === 'number') {
    return { host: typeof list[1] === 'string' ? list[1] : 'localhost', options: null }
  }
  if (!isRecord(first)) return { host: null, options: null }
  const rawHost = first.host ?? first.hostname
  if (typeof rawHost === 'string' && rawHost.length > 0) return { host: rawHost, options: first }
  if (typeof first.path === 'string') return { host: null, options: null }
  if (first.port != null) return { host: 'localhost', options: first }
  return { host: null, options: null }
}

export function patchSocketConnect(net: NetModule, hooks: SocketAllowlistHooks): void {
  const original = net.Socket.prototype.connect
  net.Socket.prototype.connect = function connect(this: unknown, ...args: unknown[]) {
    const target = connectHost(args)
    if (target.host === null || hooks.isAllowedHost(target.host))
      return Reflect.apply(original, this, args)
    const error = hooks.blockConnection(target.host)
    // IP literals skip lookup, so reject them here. Hostnames still call connect so TLS can start.
    if (!target.options || net.isIP(normalizeHost(target.host)) !== 0) throw error
    target.options.lookup = (_hostname: unknown, second: unknown, third?: unknown) => {
      const callback = typeof third === 'function' ? third : second
      if (typeof callback === 'function') (callback as DnsFn)(error)
    }
    return Reflect.apply(original, this, args)
  } as typeof original
}
