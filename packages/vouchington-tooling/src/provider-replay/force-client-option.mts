/**
 * Subclasses an SDK client constructor so every instance is built with `options[name] = value`,
 * whatever the caller configured for that option.
 */
export function forceClientOption<Client extends abstract new (...args: never[]) => object>(
  Constructor: Client,
  name: string,
  value: unknown,
): Client {
  class ForcedOptionClient extends (Constructor as unknown as new (options?: object) => object) {
    constructor(options?: object) {
      super({ ...options, [name]: value })
    }
  }
  return ForcedOptionClient as unknown as Client
}
