import { createServer } from 'node:net'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EphemeralListenerAttemptsExhaustedError,
  isRunnerReservedPort,
  listenOnRunnerUnreservedEphemeralPort,
  loadRunnerPortPolicy,
  runnerPortPolicy,
  validateRunnerPortPolicy,
} from './index.mts'

describe('runner-port-policy', () => {
  it('loads the shipped policy and recognizes its reserved range', () => {
    expect(runnerPortPolicy).toEqual({
      reservedPortStart: 2200,
      reservedPortEnd: 2999,
      portsPerRunner: 16,
      minimumRunnerSlot: 1,
      maximumRunnerSlot: 50,
    })
    expect(isRunnerReservedPort(2199)).toBe(false)
    expect(isRunnerReservedPort(2200)).toBe(true)
    expect(isRunnerReservedPort(2999)).toBe(true)
    expect(isRunnerReservedPort(3000)).toBe(false)
  })

  it('validates a caller-supplied policy object', () => {
    const policy = validateRunnerPortPolicy({
      reservedPortStart: 1000,
      reservedPortEnd: 1015,
      portsPerRunner: 8,
      minimumRunnerSlot: 1,
      maximumRunnerSlot: 2,
    })
    expect(isRunnerReservedPort(1000, policy)).toBe(true)
    expect(isRunnerReservedPort(1016, policy)).toBe(false)
  })

  it.each([
    null,
    [],
    { reservedPortStart: 1 },
    {
      reservedPortStart: 0,
      reservedPortEnd: 15,
      portsPerRunner: 16,
      minimumRunnerSlot: 1,
      maximumRunnerSlot: 1,
    },
    {
      reservedPortStart: 1,
      reservedPortEnd: 70_000,
      portsPerRunner: 16,
      minimumRunnerSlot: 1,
      maximumRunnerSlot: 1,
    },
    {
      reservedPortStart: 20,
      reservedPortEnd: 10,
      portsPerRunner: 16,
      minimumRunnerSlot: 1,
      maximumRunnerSlot: 1,
    },
    {
      reservedPortStart: 1,
      reservedPortEnd: 16,
      portsPerRunner: 0,
      minimumRunnerSlot: 1,
      maximumRunnerSlot: 1,
    },
    {
      reservedPortStart: 1,
      reservedPortEnd: 16,
      portsPerRunner: 16,
      minimumRunnerSlot: 2,
      maximumRunnerSlot: 2,
    },
    {
      reservedPortStart: 1,
      reservedPortEnd: 16,
      portsPerRunner: 16,
      minimumRunnerSlot: 1,
      maximumRunnerSlot: 0,
    },
    {
      reservedPortStart: 1,
      reservedPortEnd: 10,
      portsPerRunner: 16,
      minimumRunnerSlot: 1,
      maximumRunnerSlot: 1,
    },
  ])('rejects invalid policy %j', (policy) => {
    expect(() => validateRunnerPortPolicy(policy)).toThrow('Invalid CI runner port policy')
  })

  it('loads a policy file and includes the path in invalid-policy errors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'runner-port-policy-'))
    const policyPath = join(directory, 'policy.json')
    await writeFile(policyPath, '{"reservedPortStart":1}\n')
    const policyUrl = pathToFileURL(policyPath)
    expect(() => loadRunnerPortPolicy(policyUrl)).toThrow(policyUrl.pathname)
  })

  it('retries a reserved port before returning an unreserved listener', async () => {
    const boundPorts = [2200, 4046]
    const server = {
      address: () => ({ address: '127.0.0.1', family: 'IPv4', port: boundPorts[0] }),
      close: (callback: (error?: Error) => void) => callback(),
    }
    const listen = async () => {
      const port = boundPorts.shift()
      if (port == null) throw new Error('Test listener candidates exhausted')
      server.address = () => ({ address: '127.0.0.1', family: 'IPv4', port })
    }

    await expect(
      listenOnRunnerUnreservedEphemeralPort(
        server as unknown as import('node:net').Server,
        '127.0.0.1',
        { listen },
      ),
    ).resolves.toBe(4046)
  })

  it('honors isAllowedPort and a caller-specific attempt budget', async () => {
    const server = {
      address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 4046 }),
      close: (callback: (error?: Error) => void) => callback(),
    }

    await expect(
      listenOnRunnerUnreservedEphemeralPort(
        server as unknown as import('node:net').Server,
        '127.0.0.1',
        {
          listen: async () => undefined,
          isAllowedPort: () => false,
          maxBindAttempts: 1,
        },
      ),
    ).rejects.toMatchObject({
      maxBindAttempts: 1,
      name: 'EphemeralListenerAttemptsExhaustedError',
    })
    expect(new EphemeralListenerAttemptsExhaustedError(1)).toBeInstanceOf(Error)
  })

  it('uses a custom policy when allocating an ephemeral port', async () => {
    const policy = validateRunnerPortPolicy({
      reservedPortStart: 4000,
      reservedPortEnd: 4015,
      portsPerRunner: 16,
      minimumRunnerSlot: 1,
      maximumRunnerSlot: 1,
    })
    const server = {
      address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 4046 }),
      close: (callback: (error?: Error) => void) => callback(),
    }
    await expect(
      listenOnRunnerUnreservedEphemeralPort(
        server as unknown as import('node:net').Server,
        '127.0.0.1',
        { listen: async () => undefined, policy },
      ),
    ).resolves.toBe(4046)
  })

  it('fails when the server has no bound address', async () => {
    const server = {
      address: () => null,
      close: (callback: (error?: Error) => void) => callback(),
    }
    await expect(
      listenOnRunnerUnreservedEphemeralPort(
        server as unknown as import('node:net').Server,
        '127.0.0.1',
        { listen: async () => undefined },
      ),
    ).rejects.toThrow('Failed to allocate listener port')
  })

  it('fails when the server address is a pipe string', async () => {
    const server = {
      address: () => '/tmp/not-a-port',
      close: (callback: (error?: Error) => void) => callback(),
    }
    await expect(
      listenOnRunnerUnreservedEphemeralPort(
        server as unknown as import('node:net').Server,
        '127.0.0.1',
        { listen: async () => undefined },
      ),
    ).rejects.toThrow('Failed to allocate listener port')
  })

  it('propagates close errors after a reserved bind', async () => {
    const server = {
      address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 2200 }),
      close: (callback: (error?: Error) => void) => callback(new Error('close failed')),
    }
    await expect(
      listenOnRunnerUnreservedEphemeralPort(
        server as unknown as import('node:net').Server,
        '127.0.0.1',
        { listen: async () => undefined, maxBindAttempts: 1 },
      ),
    ).rejects.toThrow('close failed')
  })

  it('binds a real unreserved ephemeral port', async () => {
    const server = createServer()
    try {
      const port = await listenOnRunnerUnreservedEphemeralPort(server, '127.0.0.1')
      expect(isRunnerReservedPort(port)).toBe(false)
      expect(port).toBeGreaterThan(0)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
