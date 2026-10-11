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
  const guarded = new Proxy(original, {
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
