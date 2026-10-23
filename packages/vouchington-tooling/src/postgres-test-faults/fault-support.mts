import type { PostgresFaultOptions } from './fault-types.mts'

// A marker is exactly one leading SQL block comment that holds a name.
const MARKER_PATTERN = /^\/\* [^*]+ \*\/$/

export function assertFaultOptions(queryMarker: string, options: PostgresFaultOptions): void {
  if (!MARKER_PATTERN.test(queryMarker))
    throw new Error('PostgreSQL fault injection requires an exact leading query annotation')
  if (options.pools.length === 0)
    throw new Error('PostgreSQL fault injection requires at least one pool')
  if (
    options.endTimeoutMs !== undefined &&
    !(Number.isInteger(options.endTimeoutMs) && options.endTimeoutMs >= 0)
  )
    throw new Error('endTimeoutMs must be a non-negative integer')
  if (options.requestId === undefined) return
  if (options.requestId === '' || options.isOwnedRequest === undefined)
    throw new Error('Request-scoped PostgreSQL faults require a request id and isOwnedRequest')
}

export function queryText(input: unknown): string {
  return typeof input === 'string'
    ? input
    : typeof input === 'object' && input !== null && 'text' in input
      ? String(input.text)
      : ''
}

/** True when `text` starts with the marker and, if given, the command that follows it. */
export function targetsStatement(text: string, queryMarker: string, command?: string): boolean {
  const target = text.trimStart()
  if (!target.startsWith(queryMarker)) return false
  return !command || target.slice(queryMarker.length).trimStart().toUpperCase().startsWith(command)
}

/** The faulted call must be the adapter's plain `{ text }` config, never a callback or submittable. */
export function isPlainTextConfig(args: unknown[]): boolean {
  const input = args[0]
  return (
    args.length === 1 &&
    typeof input === 'object' &&
    input !== null &&
    'text' in input &&
    typeof input.text === 'string' &&
    !('callback' in input) &&
    !('submit' in input) &&
    Object.getPrototypeOf(input) === Object.prototype
  )
}

export function ownsRequest(options: PostgresFaultOptions): boolean {
  return options.requestId !== undefined && options.isOwnedRequest?.(options.requestId) === true
}

export function installProperty(object: object, key: string, value: unknown): void {
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  })
}

export function restoreProperty(
  object: object,
  key: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) Object.defineProperty(object, key, descriptor)
  else Reflect.deleteProperty(object, key)
}

export function hasErrorCode(err: unknown, code: string): err is Error {
  return err instanceof Error && 'code' in err && err.code === code
}
