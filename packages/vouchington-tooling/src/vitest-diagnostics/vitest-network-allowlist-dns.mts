export type DnsFn = (this: unknown, ...args: unknown[]) => unknown

export type DnsAllowlistHooks = {
  isAllowedHost: (host: string) => boolean
  blockDns: (host: string) => Error
  rememberAddresses: (value: unknown) => void
}

function isDnsQuery(name: string): boolean {
  return /^(lookup|lookupService|reverse|resolve)/.test(name)
}

function call(fn: unknown, ...args: unknown[]): void {
  ;(fn as DnsFn)(...args)
}

function wrapDns(original: DnsFn, promises: boolean, hooks: DnsAllowlistHooks): DnsFn {
  return function wrapped(this: unknown, ...args: unknown[]) {
    const host = typeof args[0] === 'string' ? args[0] : null
    const callback = args.at(-1)
    if (host !== null && !hooks.isAllowedHost(host)) {
      const error = hooks.blockDns(host)
      if (!promises && typeof callback === 'function') {
        queueMicrotask(() => call(callback, error))
        return undefined
      }
      if (promises) return Promise.reject(error)
      throw error
    }
    if (!promises && typeof callback === 'function') {
      const next = args.slice()
      next[next.length - 1] = (err: unknown, value: unknown, ...rest: unknown[]) => {
        if (!err) hooks.rememberAddresses(value)
        call(callback, err, value, ...rest)
      }
      return Reflect.apply(original, this, next)
    }
    const result = Reflect.apply(original, this, args)
    if (!promises || result === null || typeof result !== 'object' || !('then' in result))
      return result
    return (result as Promise<unknown>).then((value) => {
      hooks.rememberAddresses(value)
      return value
    })
  }
}

export function patchDnsSurface(
  target: object | undefined,
  promises: boolean,
  hooks: DnsAllowlistHooks,
): void {
  if (!target) return
  for (const key of Object.getOwnPropertyNames(target)) {
    if (!isDnsQuery(key)) continue
    const descriptor = Object.getOwnPropertyDescriptor(target, key)
    if (!descriptor || typeof descriptor.value !== 'function') continue
    Object.defineProperty(target, key, {
      ...descriptor,
      value: wrapDns(descriptor.value as DnsFn, promises, hooks),
    })
  }
}
