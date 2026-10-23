/**
 * Subclasses an SDK client constructor so every instance is built with `options[name] = value`,
 * whatever the caller configured for that option. The options object is the first constructor
 * argument; any further arguments are forwarded untouched.
 */
export function forceClientOption<Client extends abstract new (...args: never[]) => object>(
  Constructor: Client,
  name: string,
  value: unknown,
): Client {
  class ForcedOptionClient extends (Constructor as unknown as new (...args: unknown[]) => object) {
    constructor(options?: object, ...rest: unknown[]) {
      super({ ...options, [name]: value }, ...rest)
    }
  }
  return ForcedOptionClient as unknown as Client
}
