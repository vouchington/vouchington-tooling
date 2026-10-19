import { describe, expect, it } from 'vitest'

import {
  consumeTestNetworkAllowlistViolation,
  installTestNetworkAllowlist,
} from './vitest-network-allowlist.mts'

type Builtin = (this: void, id: string) => unknown

function readLookup(
  value: object,
): ((host: unknown, second: unknown, third?: unknown) => void) | undefined {
  if (!('lookup' in value) || typeof value.lookup !== 'function') return undefined
  return value.lookup as (host: unknown, second: unknown, third?: unknown) => void
}

function createSocket() {
  const calls: unknown[][] = []
  function Socket(this: unknown) {}
  Socket.prototype.connect = function connect(...args: unknown[]) {
    calls.push(args)
    return args
  }
  return {
    calls,
    Socket,
    isIP(host: string) {
      if (host.includes(':')) return 6
      return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ? 4 : 0
    },
  }
}

function createDns() {
  function lookup(this: unknown, _host: unknown, callback?: unknown) {
    if (typeof callback === 'function') {
      ;(callback as (err: unknown, value: unknown, family: number) => void)(null, '203.0.113.9', 4)
      return undefined
    }
    return { address: '203.0.113.9' }
  }
  function reverse(this: unknown, _host: unknown, callback?: unknown) {
    if (typeof callback === 'function') {
      ;(callback as (err: unknown, value: unknown) => void)(new Error('fail'), '198.51.100.20')
      return undefined
    }
    return Promise.resolve([
      '198.51.100.20',
      'note',
      { address: '2001:db8::1' },
      { nope: true },
      ['10.1.1.1'],
      null,
    ])
  }
  function resolve(this: unknown) {
    return null
  }
  function resolve4(this: unknown) {
    return { ok: true }
  }
  const dns = {
    lookup,
    reverse,
    resolve,
    ignored() {},
    resolveTxt: 'skip',
    promises: { lookup, reverse, resolve, resolve4 },
    Resolver: { prototype: { lookup } },
  }
  Object.defineProperty(dns, 'lookupService', { get: () => 'no-value' })
  return dns
}

function install(
  stateKey: string | undefined,
  modules: { dns: object; net: object },
  options?: { allowedHosts?: readonly string[]; isExempt?: () => boolean; sync?: boolean },
) {
  const builtinCalls: string[] = []
  let syncs = 0
  const original = Object.getOwnPropertyDescriptor(process, 'getBuiltinModule')?.value as
    | Builtin
    | undefined
  process.getBuiltinModule = ((id: string) => {
    builtinCalls.push(id)
    if (id === 'node:dns') return modules.dns
    if (id === 'node:net') return modules.net
    if (id === 'node:module') {
      return options?.sync === false ? {} : { syncBuiltinESMExports: () => (syncs += 1) }
    }
    if (original === undefined) throw new Error('missing getBuiltinModule')
    return original(id)
  }) as typeof process.getBuiltinModule
  try {
    installTestNetworkAllowlist({
      ...(stateKey === undefined ? {} : { stateKey }),
      ...(options?.allowedHosts === undefined ? {} : { allowedHosts: options.allowedHosts }),
      ...(options?.isExempt === undefined ? {} : { isExempt: options.isExempt }),
    })
    return { builtinCalls, syncs: () => syncs }
  } finally {
    process.getBuiltinModule = original as typeof process.getBuiltinModule
  }
}

describe('installTestNetworkAllowlist', () => {
  it('blocks disallowed connections and records the configured hosts', () => {
    const net = createSocket()
    const dns = createDns()
    install('test.network-allowlist.block', { dns, net }, { allowedHosts: ['example.test'] })

    expect(() => net.Socket.prototype.connect({ host: '203.0.113.10', port: 443 })).toThrow(
      /a connection to "203.0.113.10".*example\.test/,
    )
    expect(() => net.Socket.prototype.connect(443, '203.0.113.50')).toThrow(/203\.0\.113\.50/)
    const message = consumeTestNetworkAllowlistViolation()
    expect(message).toContain('203.0.113.10')
    expect(message).toContain('\n')
    expect(message).toContain('203.0.113.50')
    expect(consumeTestNetworkAllowlistViolation('test.network-allowlist.block')).toBeNull()
  })

  it('allows exempt callers, loopback, and non-host argument forms', () => {
    const net = createSocket()
    install(
      'test.network-allowlist.allow',
      { dns: {}, net },
      { allowedHosts: ['example.test'], isExempt: () => true },
    )
    expect(net.Socket.prototype.connect({ host: 'evil.test', port: 1 })).toEqual([
      { host: 'evil.test', port: 1 },
    ])

    const restricted = createSocket()
    install(
      'test.network-allowlist.loopback',
      { dns: createDns(), net: restricted },
      {
        allowedHosts: ['example.test'],
      },
    )
    for (const host of [
      'Example.Test.',
      '[::1]',
      'foo.localhost',
      '::',
      '0:0:0:0:0:0:0:1',
      '::ffff:127.0.0.1',
      '127.0.0.1',
      '0.0.0.0',
    ]) {
      restricted.Socket.prototype.connect({ host })
    }
    restricted.Socket.prototype.connect({ port: 80 })
    restricted.Socket.prototype.connect({ path: '/tmp/app.sock' })
    restricted.Socket.prototype.connect({})
    restricted.Socket.prototype.connect('evil.test')
    restricted.Socket.prototype.connect(443)
    restricted.Socket.prototype.connect(443, 'example.test')
    expect(restricted.calls).toHaveLength(14)

    const options = { host: 'evil.test', port: 1 }
    restricted.Socket.prototype.connect(options)
    const errors: unknown[] = []
    readLookup(options)?.('evil.test', {}, (error: unknown) => errors.push(error))
    readLookup(options)?.('evil.test', (error: unknown) => errors.push(error))
    readLookup(options)?.('evil.test', 1)
    expect(errors).toHaveLength(2)
    expect(() => restricted.Socket.prototype.connect([{ host: '10.0.0.1' }])).toThrow(/10\.0\.0\.1/)
    expect(() => restricted.Socket.prototype.connect({ host: '127.0.0.256' })).toThrow(
      /127\.0\.0\.256/,
    )
    expect(() => restricted.Socket.prototype.connect({ host: '127.0.1' })).not.toThrow()
  })

  it('filters DNS lookups and remembers addresses from allowed queries', async () => {
    const net = createSocket()
    const dns = createDns()
    install('test.network-allowlist.dns', { dns, net }, { allowedHosts: ['example.test'] })

    let callbackError: unknown
    expect(
      dns.lookup('evil.test', (error: unknown) => {
        callbackError = error
      }),
    ).toBeUndefined()
    expect(callbackError).toBeInstanceOf(Error)
    await expect(dns.promises.lookup('evil.test')).rejects.toThrow(/a DNS lookup for "evil.test"/)
    expect(() => dns.lookup('evil.test')).toThrow(Error)

    void dns.reverse('example.test', () => {})
    expect(() => net.Socket.prototype.connect({ host: '198.51.100.20' })).toThrow(
      /198\.51\.100\.20/,
    )

    dns.lookup(' Example.Test. ', () => {})
    dns.lookup({ host: 'ignored' })
    expect(dns.resolve()).toBeNull()
    expect(dns.promises.resolve()).toBeNull()
    expect(dns.promises.resolve4()).toEqual({ ok: true })
    await dns.promises.reverse('example.test')
    net.Socket.prototype.connect({ host: '203.0.113.9' })
    net.Socket.prototype.connect({ host: '2001:db8::1' })
    net.Socket.prototype.connect({ host: '10.1.1.1' })
    expect(net.calls).toHaveLength(3)
  })

  it('installs once per state key and skips patching when Socket is not a function', () => {
    const net = createSocket()
    const first = install(
      'test.network-allowlist.once',
      { dns: createDns(), net },
      {
        allowedHosts: ['example.test'],
      },
    )
    const second = install(
      'test.network-allowlist.once',
      { dns: createDns(), net },
      {
        allowedHosts: ['other.test'],
      },
    )
    expect(second.builtinCalls).toEqual([])
    expect(first.syncs()).toBe(1)
    expect(() => net.Socket.prototype.connect(443, 'other.test')).toThrow(/other\.test/)
    expect(net.Socket.prototype.connect(443, 'example.test')).toEqual([443, 'example.test'])

    const bare = install(
      'test.network-allowlist.bare-socket',
      { dns: createDns(), net: { Socket: 1, isIP: () => 0 } },
      { sync: false },
    )
    expect(bare.syncs()).toBe(0)
    expect(bare.builtinCalls).toEqual(['node:dns', 'node:net'])
  })

  it('names the default hosts when the caller does not pass an allowlist', () => {
    const net = createSocket()
    install(undefined, { dns: {}, net })
    expect(() => net.Socket.prototype.connect({ host: '203.0.113.10' })).toThrow(
      /example\.com, example\.net, example\.org/,
    )
  })

  it('returns before patching when the builtin probe is missing', () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'getBuiltinModule')
    Object.defineProperty(process, 'getBuiltinModule', { configurable: true, value: undefined })
    try {
      installTestNetworkAllowlist({ stateKey: 'test.network-allowlist.no-probe' })
      expect(consumeTestNetworkAllowlistViolation()).toBeNull()
    } finally {
      if (descriptor) Object.defineProperty(process, 'getBuiltinModule', descriptor)
    }
  })
})
