import { describe, expect, it } from 'vitest'
import { protocolBindingRequested, requestedProtocolKey } from './protocol-requested-keys.mts'
import type { RouteBinding } from './response-contract-route-analysis.mts'

const binding: RouteBinding = { method: 'GET', routeTemplate: '/users/:id' }

describe('protocol requested keys', () => {
  it('selects every route without a requested-key filter', () => {
    expect(protocolBindingRequested(binding)).toBe(true)
    expect(requestedProtocolKey('GET:/users/:id#protocol-2', binding)).toBe(
      'GET:/users/:id#protocol-2',
    )
  })

  it('rejects empty and unrelated route filters', () => {
    expect(protocolBindingRequested(binding, new Set())).toBe(false)
    expect(protocolBindingRequested(binding, new Set(['POST:/users/:id', 'GET:/teams/:id']))).toBe(
      false,
    )
    expect(requestedProtocolKey('GET:/users/:id', binding, new Set())).toBeUndefined()
  })

  it('matches method and static path exactly while normalizing parameter names', () => {
    expect(protocolBindingRequested(binding, new Set(['GET:/users/:userId#protocol-4']))).toBe(true)
    expect(protocolBindingRequested(binding, new Set(['POST:/users/:userId']))).toBe(false)
    expect(protocolBindingRequested(binding, new Set(['GET:/accounts/:userId']))).toBe(false)
  })

  it('translates renamed parameters and preserves an explicit generated suffix', () => {
    expect(
      requestedProtocolKey(
        'GET:/users/:id#protocol-2',
        binding,
        new Set(['GET:/users/:userId#protocol-2']),
      ),
    ).toBe('GET:/users/:userId#protocol-2')
  })

  it('matches a requested base only to the unsuffixed protocol key', () => {
    const requested = new Set(['GET:/users/:userId'])
    expect(requestedProtocolKey('GET:/users/:id', binding, requested)).toBe('GET:/users/:userId')
    expect(requestedProtocolKey('GET:/users/:id#protocol-1', binding, requested)).toBeUndefined()
    expect(requestedProtocolKey('GET:/users/:id#named', binding, requested)).toBeUndefined()
  })

  it('matches explicit generated and named variants only by their exact suffix', () => {
    const requested = new Set(['GET:/users/:userId#protocol-2', 'GET:/users/:userId#named'])
    expect(requestedProtocolKey('GET:/users/:id#protocol-2', binding, requested)).toBe(
      'GET:/users/:userId#protocol-2',
    )
    expect(requestedProtocolKey('GET:/users/:id#protocol-1', binding, requested)).toBeUndefined()
    expect(requestedProtocolKey('GET:/users/:id#named', binding, requested)).toBe(
      'GET:/users/:userId#named',
    )
  })

  it('prefers an exact route spelling over a normalized equivalent', () => {
    expect(
      requestedProtocolKey(
        'GET:/users/:id#protocol-2',
        binding,
        new Set(['GET:/users/:id#protocol-2', 'GET:/users/:userId#protocol-2']),
      ),
    ).toBe('GET:/users/:id#protocol-2')
  })

  it('chooses a deterministic requested spelling when only normalized routes match', () => {
    expect(
      requestedProtocolKey(
        'GET:/users/:id#protocol-2',
        binding,
        new Set(['GET:/users/:userId#protocol-2', 'GET:/users/:accountId#protocol-2']),
      ),
    ).toBe('GET:/users/:accountId#protocol-2')
  })
  it('rejects malformed generated and requested keys without selecting a route', () => {
    expect(protocolBindingRequested(binding, new Set(['missing', ':/users/:id']))).toBe(false)
    expect(requestedProtocolKey('missing', binding, new Set(['GET:/users/:id']))).toBeUndefined()
    expect(
      requestedProtocolKey('POST:/users/:id', binding, new Set(['GET:/users/:id'])),
    ).toBeUndefined()
    expect(requestedProtocolKey('GET:/users/:id', binding, new Set(['missing']))).toBeUndefined()
  })
})
