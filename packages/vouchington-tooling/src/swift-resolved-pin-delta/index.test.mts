import { describe, expect, it } from 'vitest'

import { type ResolvedDocument, type ResolvedPin, validateResolvedPinDelta } from './index.mts'

const skip = (revision: string, version: string): ResolvedPin => ({
  identity: 'skip',
  kind: 'remoteSourceControl',
  location: 'https://source.skip.tools/skip.git',
  state: { revision, version },
})
const retainedPin = {
  identity: 'skip-fuse-ui',
  kind: 'remoteSourceControl',
  location: 'https://source.skip.tools/skip-fuse-ui.git',
  state: { revision: 'c'.repeat(40), version: '1.0.1' },
}
const addedPin = {
  identity: 'opencombine',
  kind: 'remoteSourceControl',
  location: 'https://github.com/OpenSwiftUIProject/OpenCombine.git',
  state: { revision: '63aef318cb3a853bcb8d774cce15f4dcb1ccdfe4', version: '0.15.1' },
}
const trusted: ResolvedDocument = {
  originHash: 'f'.repeat(64),
  pins: [skip('d'.repeat(40), '1.9.5'), retainedPin],
  version: 3,
}
const candidate: ResolvedDocument = {
  originHash: 'e'.repeat(64),
  pins: [addedPin, skip('a'.repeat(40), '1.9.7'), retainedPin],
  version: 3,
}

function replacePin(identity: string, replacement: ResolvedPin): ResolvedDocument {
  return {
    ...candidate,
    pins: (candidate.pins ?? []).map((pin) => (pin.identity === identity ? replacement : pin)),
  }
}

describe('validateResolvedPinDelta', () => {
  it('allows a unique exact addition and freezes trusted non-required pins', () => {
    expect(() => validateResolvedPinDelta(trusted, candidate)).not.toThrow()
    expect(() =>
      validateResolvedPinDelta(trusted, {
        ...candidate,
        pins: (candidate.pins ?? []).filter((pin) => pin.identity !== retainedPin.identity),
      }),
    ).toThrow('keep every trusted non-skip pin unchanged')
  })

  it('keeps the trusted required identity source', () => {
    expect(() =>
      validateResolvedPinDelta(
        trusted,
        replacePin('skip', {
          ...skip('a'.repeat(40), '1.9.7'),
          location: 'https://example.invalid/skip.git',
        }),
      ),
    ).toThrow('keep the trusted skip source')
  })

  it('accepts a custom required identity', () => {
    const core = { ...skip('d'.repeat(40), '1.0.0'), identity: 'core' }
    const trustedCore: ResolvedDocument = { ...trusted, pins: [core, retainedPin] }
    const candidateCore: ResolvedDocument = {
      ...candidate,
      pins: [
        addedPin,
        { ...core, state: { revision: 'a'.repeat(40), version: '1.0.1' } },
        retainedPin,
      ],
    }
    expect(() =>
      validateResolvedPinDelta(trustedCore, candidateCore, { requiredIdentity: 'core' }),
    ).not.toThrow()
  })

  it('rejects malformed pins and lock shape', () => {
    expect(() => validateResolvedPinDelta({ ...trusted, version: 2 }, candidate)).toThrow(
      'version 3 lock',
    )
    expect(() =>
      validateResolvedPinDelta(
        trusted,
        replacePin(addedPin.identity, { ...addedPin, kind: 'registry' }),
      ),
    ).toThrow('fully specified exact pins')
    expect(() =>
      validateResolvedPinDelta(
        trusted,
        replacePin(addedPin.identity, {
          ...addedPin,
          state: { ...addedPin.state, version: '1.2.3-01' },
        }),
      ),
    ).toThrow('fully specified exact pins')
    expect(() =>
      validateResolvedPinDelta(trusted, { originHash: 'e'.repeat(64), version: 3 }),
    ).toThrow('must contain pins')
    expect(() =>
      validateResolvedPinDelta(trusted, {
        ...candidate,
        pins: [...(candidate.pins ?? []), addedPin],
      }),
    ).toThrow('unique pin identities')
  })
})
