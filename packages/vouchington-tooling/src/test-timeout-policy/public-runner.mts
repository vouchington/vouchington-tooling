export type Protector = (runner: { config: object }, maximum: number) => void
export type RunnerConstructor = new (...args: never[]) => { config: object }
const constructors = new WeakMap<
  RunnerConstructor,
  WeakMap<Protector, Map<number, RunnerConstructor>>
>()

/** Compose a final public constructor while retaining direct and derived new.target contracts. */
export function guardPublicRunner<T extends RunnerConstructor>(
  original: T,
  maximum: number,
  protect: Protector,
): T {
  let policies = constructors.get(original)
  if (!policies) {
    policies = new WeakMap()
    constructors.set(original, policies)
  }
  let deadlines = policies.get(protect)
  if (!deadlines) {
    deadlines = new Map()
    policies.set(protect, deadlines)
  }
  const existing = deadlines.get(maximum)
  if (existing) return existing as T
  const methods = new WeakMap<Function, Function>()
  const guarded = new Proxy(original, {
    get(target, key, receiver) {
      const direct = receiver === guarded
      const value: unknown = Reflect.get(target, key, direct ? target : receiver)
      if (!direct || typeof value !== 'function') return value
      const descriptor = staticDescriptor(target, key)
      // Callable-valued fields are public values, including Vitest's exported static aliases.
      if (
        !descriptor ||
        typeof descriptor.value !== 'function' ||
        descriptor.enumerable === true ||
        (descriptor?.configurable === false && descriptor.writable === false)
      )
        return value
      const existing = methods.get(value)
      if (existing) return existing
      const method = new Proxy(value, {
        apply(callable, owner, args) {
          return Reflect.apply(callable, owner === guarded ? target : owner, args)
        },
      })
      methods.set(value, method)
      return method
    },
    construct(target, args, newTarget) {
      const runner = Reflect.construct(
        target,
        args,
        newTarget === guarded ? target : newTarget,
      ) as InstanceType<T>
      protect(runner, maximum)
      return runner
    },
  })
  deadlines.set(maximum, guarded)
  return guarded
}

/** Class-owned descriptors distinguish methods from fields without changing Function APIs. */
function staticDescriptor(target: object, key: PropertyKey): PropertyDescriptor | undefined {
  let owner: object | null = target
  while (owner && owner !== Function.prototype) {
    const descriptor = Reflect.getOwnPropertyDescriptor(owner, key)
    if (descriptor) return descriptor
    owner = Reflect.getPrototypeOf(owner)
  }
  return undefined
}
