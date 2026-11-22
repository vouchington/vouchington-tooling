export type Validation = (timeout: unknown, label: string) => number
export type FixtureTimeoutGuard = {
  validate: Validation
  /** Name of the automatic guard fixture that fixtures and `use()` must not override. */
  fixtureName: string
  /** Human-readable cap such as "30,000 ms", used in error messages. */
  capText: string
}
type Watchpoint = { target: object; descriptors: PropertyDescriptorMap; prototype: object | null }
type Snapshot = { view: object; guard: FixtureTimeoutGuard; watchpoints: Watchpoint[] }
const snapshots = new WeakMap<object, Snapshot>()

function watch(target: object): Watchpoint {
  return {
    target,
    descriptors: Object.getOwnPropertyDescriptors(target),
    prototype: Object.getPrototypeOf(target),
  }
}

function unchanged({ target, descriptors, prototype }: Watchpoint): boolean {
  const current = Object.getOwnPropertyDescriptors(target)
  const keys = Reflect.ownKeys(descriptors)
  return (
    Object.getPrototypeOf(target) === prototype &&
    keys.length === Reflect.ownKeys(current).length &&
    keys.every((key) => {
      const before = Reflect.get(descriptors, key) as PropertyDescriptor
      const after = Reflect.get(current, key) as PropertyDescriptor | undefined
      return (
        after !== undefined &&
        before.get === after.get &&
        before.set === after.set &&
        Object.is(before.value, after.value) &&
        before.writable === after.writable &&
        before.enumerable === after.enumerable &&
        before.configurable === after.configurable
      )
    })
  )
}

function overrideError(guard: FixtureTimeoutGuard): RangeError {
  return new RangeError(
    `Playwright timeout guard overrides are forbidden by the ${guard.capText} test cap`,
  )
}

export function snapshotFixtureTimeouts(fixtures: object, guard: FixtureTimeoutGuard): object {
  const { validate } = guard
  const existing = snapshots.get(fixtures)
  if (existing !== undefined) {
    if (existing.guard !== guard || !existing.watchpoints.every(unchanged))
      throw new RangeError('Playwright fixture configuration changed after its deadline snapshot')
    return existing.view
  }
  if (Object.hasOwn(fixtures, guard.fixtureName)) throw overrideError(guard)
  const watchpoints: Watchpoint[] = []
  const tuples = new WeakMap<object, readonly unknown[]>()
  const normalize = (value: unknown, knownOptions?: object): unknown => {
    if (!Array.isArray(value)) return value
    const existingTuple = tuples.get(value)
    if (existingTuple !== undefined) return existingTuple
    const options: unknown = knownOptions ?? Reflect.get(value, '1', value)
    if (typeof options !== 'object' || options === null) return value
    const captured = snapshotOptionsTimeout(options, validate, 'Playwright fixture timeout')
    const tuple: unknown[] = []
    Object.defineProperties(tuple, {
      0: { enumerable: true, get: (): unknown => Reflect.get(value, '0', value) },
      1: { enumerable: true, value: captured },
    })
    watchpoints.push(watch(value))
    for (let owner: object | null = options; owner !== null; owner = Object.getPrototypeOf(owner)) {
      watchpoints.push(watch(owner))
      if (Object.hasOwn(owner, 'timeout')) break
    }
    tuples.set(value, Object.freeze(tuple))
    return tuple
  }
  // Validate known data tuples without invoking fixture or tuple-slot getters.
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(fixtures))) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) continue
    const value: unknown = descriptor.value
    if (!Array.isArray(value)) continue
    const slot = Object.getOwnPropertyDescriptor(value, '1')
    const options: unknown = slot && Object.hasOwn(slot, 'value') ? slot.value : undefined
    if (typeof options === 'object' && options !== null) normalize(value, options)
  }
  // Native fixture pools enumerate later. A separate extensible target also supports frozen inputs.
  const view = new Proxy(
    {},
    {
      ownKeys() {
        if (Object.hasOwn(fixtures, guard.fixtureName)) throw overrideError(guard)
        return Reflect.ownKeys(fixtures)
      },
      getOwnPropertyDescriptor(_target, key) {
        const descriptor = Object.getOwnPropertyDescriptor(fixtures, key)
        return descriptor && { ...descriptor, configurable: true }
      },
      get: (_target, key) => normalize(Reflect.get(fixtures, key, fixtures)),
    },
  )
  watchpoints.push(watch(fixtures))
  snapshots.set(fixtures, { view, guard, watchpoints })
  return view
}

export function snapshotOptionsTimeout(
  options: object,
  validate: Validation,
  label: string,
): object {
  const declared: unknown = Reflect.get(options, 'timeout')
  const timeout = declared === undefined ? undefined : validate(declared, label)
  return new Proxy(options, {
    get: (target, key): unknown => (key === 'timeout' ? timeout : Reflect.get(target, key, target)),
  })
}
