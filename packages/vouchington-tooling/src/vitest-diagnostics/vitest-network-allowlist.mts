import { patchDnsSurface, type DnsFn } from './vitest-network-allowlist-dns.mts'

// Real sockets and DNS may reach only the configured hosts, loopback, and local binds.
// The probe uses process.getBuiltinModule and does not import node:dns or node:net.

export type TestNetworkAllowlistOptions = {
  allowedHosts?: readonly string[]
  isExempt?: () => boolean
  stateKey?: string
}

const DEFAULT_HOSTS = ['example.com', 'example.net', 'example.org']
const DEFAULT_STATE_KEY = 'test.networkAllowlist'
let activeStateKey = DEFAULT_STATE_KEY

function defaultExempt(): boolean {
  return false
}

type AllowlistState = {
  installed: boolean
  violations: string[]
  allowedIps: Set<string>
  allowedHosts: Set<string>
  isExempt: () => boolean
}

type DnsSurface = { promises?: DnsSurface; Resolver?: { prototype: DnsSurface } }
type NetModule = { isIP: (host: string) => number; Socket: { prototype: { connect: DnsFn } } }
type ConnectTarget = { host: string | null; options: Record<string, unknown> | null }

function state(key = activeStateKey): AllowlistState {
  return ((globalThis as unknown as Record<symbol, AllowlistState | undefined>)[Symbol.for(key)] ??=
    {
      installed: false,
      violations: [],
      allowedIps: new Set(),
      allowedHosts: new Set(DEFAULT_HOSTS),
      isExempt: defaultExempt,
    })
}

class TestNetworkAllowlistError extends Error {
  code: string
  constructor(message: string) {
    super(message)
    this.name = 'TestNetworkAllowlistError'
    this.code = 'TEST_NETWORK_ALLOWLIST'
  }
}

function normalizeHost(host: string): string {
  let value = host.trim().toLowerCase()
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  if (value.endsWith('.')) value = value.slice(0, -1)
  return value
}

function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::' || host === '::1' || host === '0:0:0:0:0:0:0:1' || host === '0.0.0.0')
    return true
  if (host.startsWith('::ffff:')) return isLoopbackHost(host.slice('::ffff:'.length))
  const parts = host.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false
  const octets = parts.map(Number)
  return octets[0] === 127 && octets.every((part) => part <= 255)
}

function isAllowedHost(host: string): boolean {
  const current = state()
  if (current.isExempt()) return true
  const normalized = normalizeHost(host)
  return (
    current.allowedHosts.has(normalized) ||
    isLoopbackHost(normalized) ||
    current.allowedIps.has(normalized)
  )
}

function block(kind: 'dns' | 'connection', host: string): TestNetworkAllowlistError {
  const action = kind === 'dns' ? 'a DNS lookup for' : 'a connection to'
  const allowed = [...state().allowedHosts].toSorted().join(', ')
  const message = `Test network allowlist blocked ${action} "${normalizeHost(host)}". Tests may only reach ${allowed}, and loopback.`
  state().violations.push(message)
  return new TestNetworkAllowlistError(message)
}

function rememberAddresses(value: unknown): void {
  const ips = state().allowedIps
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      if (item.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(item)) ips.add(normalizeHost(item))
      return
    }
    if (Array.isArray(item)) {
      for (const entry of item) visit(entry)
      return
    }
    if (typeof item === 'object' && item !== null && 'address' in item) {
      visit((item as { address: unknown }).address)
    }
  }
  visit(value)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function patchSocketConnect(net: NetModule): void {
  const original = net.Socket.prototype.connect
  net.Socket.prototype.connect = function connect(this: unknown, ...args: unknown[]) {
    const target = connectHost(args)
    if (target.host === null || isAllowedHost(target.host))
      return Reflect.apply(original, this, args)
    const error = block('connection', target.host)
    // IP literals skip lookup, so reject them here. Hostnames still call connect so TLS can start.
    if (!target.options || net.isIP(normalizeHost(target.host)) !== 0) throw error
    target.options.lookup = (_hostname: unknown, second: unknown, third?: unknown) => {
      const callback = typeof third === 'function' ? third : second
      if (typeof callback === 'function') (callback as DnsFn)(error)
    }
    return Reflect.apply(original, this, args)
  } as typeof original
}

export function installTestNetworkAllowlist(options: TestNetworkAllowlistOptions = {}): void {
  activeStateKey = options.stateKey ?? DEFAULT_STATE_KEY
  const current = state(activeStateKey)
  if (current.installed) return
  current.installed = true
  current.allowedHosts = new Set(options.allowedHosts ?? DEFAULT_HOSTS)
  current.isExempt = options.isExempt ?? defaultExempt
  if (typeof process.getBuiltinModule !== 'function') return
  const dns = process.getBuiltinModule('node:dns') as DnsSurface
  const net = process.getBuiltinModule('node:net') as NetModule
  if (typeof net.Socket !== 'function') return
  const hooks = {
    isAllowedHost,
    blockDns: (host: string) => block('dns', host),
    rememberAddresses,
  }
  patchDnsSurface(dns, false, hooks)
  patchDnsSurface(dns.promises, true, hooks)
  patchDnsSurface(dns.Resolver?.prototype, false, hooks)
  patchDnsSurface(dns.promises?.Resolver?.prototype, true, hooks)
  patchSocketConnect(net)
  const nodeModule = process.getBuiltinModule('node:module') as {
    syncBuiltinESMExports?: () => void
  }
  nodeModule.syncBuiltinESMExports?.()
}

export function consumeTestNetworkAllowlistViolation(stateKey = activeStateKey): string | null {
  const violations = state(stateKey).violations
  if (violations.length === 0) return null
  const message = violations.join('\n')
  violations.length = 0
  return message
}
