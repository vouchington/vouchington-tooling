import type { Server } from 'node:net'
import { describe, expect, it } from 'vitest'
import { listenOnLoopbackEphemeralPort } from './index.mts'

function fakeServer(port: number): Server {
  return {
    address: () => ({ address: '::1', family: 'IPv6', port }),
    close: (callback: (error?: Error) => void) => callback(),
  } as unknown as Server
}

function codedError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

describe('listenOnLoopbackEphemeralPort', () => {
  it('binds IPv6 loopback when available', async () => {
    const hosts: string[] = []
    const listen = async (_server: Server, host: string) => {
      hosts.push(host)
    }
    await expect(listenOnLoopbackEphemeralPort(fakeServer(4046), { listen })).resolves.toEqual({
      host: '::1',
      port: 4046,
    })
    expect(hosts).toEqual(['::1'])
  })

  it('falls back to IPv4 loopback on EAFNOSUPPORT', async () => {
    const hosts: string[] = []
    const listen = async (_server: Server, host: string) => {
      hosts.push(host)
      if (host === '::1') throw codedError('EAFNOSUPPORT')
    }
    await expect(listenOnLoopbackEphemeralPort(fakeServer(4046), { listen })).resolves.toEqual({
      host: '127.0.0.1',
      port: 4046,
    })
    expect(hosts).toEqual(['::1', '127.0.0.1'])
  })

  it('rethrows errors with another code', async () => {
    const listen = async () => {
      throw codedError('EADDRINUSE')
    }
    await expect(listenOnLoopbackEphemeralPort(fakeServer(4046), { listen })).rejects.toThrow(
      'EADDRINUSE',
    )
  })

  it('rethrows errors without a code and non-Error values', async () => {
    await expect(
      listenOnLoopbackEphemeralPort(fakeServer(4046), {
        listen: async () => {
          throw new Error('plain')
        },
      }),
    ).rejects.toThrow('plain')
    await expect(
      listenOnLoopbackEphemeralPort(fakeServer(4046), {
        listen: () => Promise.reject('not an error'),
      }),
    ).rejects.toBe('not an error')
  })

  it('skips reserved ports on the loopback listener', async () => {
    const ports = [2200, 4046]
    const server = fakeServer(0)
    const listen = async () => {
      const port = ports.shift() as number
      server.address = () => ({ address: '::1', family: 'IPv6', port })
    }
    await expect(listenOnLoopbackEphemeralPort(server, { listen })).resolves.toMatchObject({
      port: 4046,
    })
  })

  it('does not fall back when isAllowedPort throws EAFNOSUPPORT after a successful bind', async () => {
    const hosts: string[] = []
    const listen = async (_server: Server, host: string) => {
      hosts.push(host)
    }
    await expect(
      listenOnLoopbackEphemeralPort(fakeServer(4046), {
        listen,
        isAllowedPort: () => {
          throw codedError('EAFNOSUPPORT')
        },
      }),
    ).rejects.toThrow('EAFNOSUPPORT')
    expect(hosts).toEqual(['::1'])
  })

  it('uses the default listener against the server when none is injected', async () => {
    const listened: unknown[][] = []
    const server = {
      once: () => undefined,
      off: () => undefined,
      listen: (...args: unknown[]) => {
        listened.push(args.slice(0, 2))
        ;(args[2] as () => void)()
      },
      address: () => ({ address: '::1', family: 'IPv6', port: 4046 }),
    } as unknown as Server
    await expect(listenOnLoopbackEphemeralPort(server)).resolves.toEqual({
      host: '::1',
      port: 4046,
    })
    expect(listened).toEqual([[0, '::1']])
  })
})
