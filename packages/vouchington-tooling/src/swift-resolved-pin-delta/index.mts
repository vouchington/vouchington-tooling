export type ResolvedPin = {
  identity?: string
  kind?: string
  location?: string
  state?: { revision?: string; version?: string }
}
export type ResolvedDocument = { originHash?: string; pins?: ResolvedPin[]; version?: number }

export type ValidateResolvedPinDeltaOptions = {
  requiredIdentity?: string
}

type ExactResolvedPin = {
  identity: string
  kind: string
  location: string
  state: { revision: string; version: string }
}

function isExactSemver(value: string | undefined): boolean {
  const match = value?.match(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  )
  return Boolean(
    match &&
    !match.groups?.prerelease
      ?.split('.')
      .some(
        (identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier[0] === '0',
      ),
  )
}

function exactPins(resolved: ResolvedDocument): Map<string, ExactResolvedPin> {
  if (!Array.isArray(resolved.pins)) throw new Error('Package.resolved must contain pins')
  const pins = new Map<string, ExactResolvedPin>()
  for (const pin of resolved.pins) {
    const state = pin.state
    if (
      !pin.identity?.match(/^[a-z0-9][a-z0-9.-]*$/) ||
      pin.kind !== 'remoteSourceControl' ||
      !pin.location?.match(/^https:\/\/[^\s]+$/) ||
      !state?.revision?.match(/^[a-f0-9]{40}$/) ||
      !isExactSemver(state.version) ||
      Object.keys(pin).toSorted().join(',') !== 'identity,kind,location,state' ||
      Object.keys(state).toSorted().join(',') !== 'revision,version'
    ) {
      throw new Error('Package.resolved pins must remain fully specified exact pins')
    }
    if (pins.has(pin.identity)) {
      throw new Error('Package.resolved must contain unique pin identities')
    }
    pins.set(pin.identity, pin as ExactResolvedPin)
  }
  return pins
}

function canonicalPin(pin: ExactResolvedPin): string {
  return JSON.stringify({
    identity: pin.identity,
    kind: pin.kind,
    location: pin.location,
    state: { revision: pin.state.revision, version: pin.state.version },
  })
}

export function validateResolvedPinDelta(
  trustedResolved: ResolvedDocument,
  candidateResolved: ResolvedDocument,
  options: ValidateResolvedPinDeltaOptions = {},
): void {
  const requiredIdentity = options.requiredIdentity ?? 'skip'
  if (
    trustedResolved.version !== 3 ||
    candidateResolved.version !== 3 ||
    !candidateResolved.originHash?.match(/^[a-f0-9]{64}$/)
  ) {
    throw new Error('Package.resolved must remain a version 3 lock with an origin hash')
  }
  const trustedPins = exactPins(trustedResolved)
  const candidatePins = exactPins(candidateResolved)
  const trustedRequired = trustedPins.get(requiredIdentity)
  const candidateRequired = candidatePins.get(requiredIdentity)
  if (
    !trustedRequired ||
    !candidateRequired ||
    trustedRequired.kind !== candidateRequired.kind ||
    trustedRequired.location !== candidateRequired.location
  ) {
    throw new Error(`Package.resolved must keep the trusted ${requiredIdentity} source`)
  }
  for (const [identity, trustedPin] of trustedPins) {
    if (identity === requiredIdentity) continue
    const candidatePin = candidatePins.get(identity)
    if (!candidatePin || canonicalPin(candidatePin) !== canonicalPin(trustedPin)) {
      throw new Error(
        `Package.resolved must keep every trusted non-${requiredIdentity} pin unchanged`,
      )
    }
  }
}
