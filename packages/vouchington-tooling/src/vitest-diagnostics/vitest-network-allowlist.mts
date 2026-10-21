import { patchDnsSurface } from './vitest-network-allowlist-dns.mts'
import {
  isAllowedHost,
  normalizeHost,
  rememberAddresses,
} from './vitest-network-allowlist-host.mts'
import { patchSocketConnect, type NetModule } from './vitest-network-allowlist-socket.mts'

// Real sockets and DNS may reach only the configured hosts, loopback, and local binds.
// The probe uses process.getBuiltinModule and does not import node:dns or node:net.

export type TestNetworkAllowlistOptions = {
  allowedHosts?: readonly string[]
  isExempt?: () => boolean
  stateKey?: string
}

const DEFAULT_HOSTS = ['example.com', 'example.net', 'example.org']
const DEFAULT_STATE_KEY = 'test.networkAllowlist'

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

function state(key = DEFAULT_STATE_KEY): AllowlistState {
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

function block(key: string, kind: 'dns' | 'connection', host: string): TestNetworkAllowlistError {
  const action = kind === 'dns' ? 'a DNS lookup for' : 'a connection to'
  const current = state(key)
  const allowed = [...current.allowedHosts].toSorted().join(', ')
  const message = `Test network allowlist blocked ${action} "${normalizeHost(host)}". Tests may only reach ${allowed}, and loopback.`
  current.violations.push(message)
  return new TestNetworkAllowlistError(message)
}

export function installTestNetworkAllowlist(options: TestNetworkAllowlistOptions = {}): void {
  const key = options.stateKey ?? DEFAULT_STATE_KEY
  const current = state(key)
  if (current.installed) return
  current.installed = true
  current.allowedHosts = new Set(options.allowedHosts ?? DEFAULT_HOSTS)
  current.isExempt = options.isExempt ?? defaultExempt
  if (typeof process.getBuiltinModule !== 'function') return
  const dns = process.getBuiltinModule('node:dns') as DnsSurface
  const net = process.getBuiltinModule('node:net') as NetModule
  if (typeof net.Socket !== 'function') return
  const hooks = {
    isAllowedHost: (host: string) => isAllowedHost(host, state(key)),
    blockDns: (host: string) => block(key, 'dns', host),
    rememberAddresses: (value: unknown) => rememberAddresses(value, state(key).allowedIps),
  }
  patchDnsSurface(dns, false, hooks)
  patchDnsSurface(dns.promises, true, hooks)
  patchDnsSurface(dns.Resolver?.prototype, false, hooks)
  patchDnsSurface(dns.promises?.Resolver?.prototype, true, hooks)
  patchSocketConnect(net, {
    isAllowedHost: hooks.isAllowedHost,
    blockConnection: (host: string) => block(key, 'connection', host),
  })
  const nodeModule = process.getBuiltinModule('node:module') as {
    syncBuiltinESMExports?: () => void
  }
  nodeModule.syncBuiltinESMExports?.()
}

export function consumeTestNetworkAllowlistViolation(stateKey = DEFAULT_STATE_KEY): string | null {
  const violations = state(stateKey).violations
  if (violations.length === 0) return null
  const message = violations.join('\n')
  violations.length = 0
  return message
}
