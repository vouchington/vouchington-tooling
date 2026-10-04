import type { RouteBinding } from './response-contract-route-analysis.mts'
import { routeShape } from './registered-route-catalog.mts'

type ParsedProtocolKey = {
  method: string
  routeTemplate: string
  suffix: string
  base: string
}

/** Whether requested protocol keys include a route binding, independent of its protocol variants. */
export function protocolBindingRequested(
  binding: RouteBinding,
  requestedKeys?: ReadonlySet<string>,
): boolean {
  if (!requestedKeys) return true
  return [...requestedKeys].some((key) => {
    const requested = parseProtocolKey(key)
    return requested && sameRoute(requested, binding)
  })
}

/** Maps one generated protocol key to its requested route spelling and exact variant suffix. */
export function requestedProtocolKey(
  key: string,
  binding: RouteBinding,
  requestedKeys?: ReadonlySet<string>,
): string | undefined {
  if (!requestedKeys) return key
  if (requestedKeys.size === 0) return undefined

  const generated = parseProtocolKey(key)
  if (!generated || !sameRoute(generated, binding)) return undefined

  const candidates: { key: string; parsed: ParsedProtocolKey }[] = []
  for (const requestedKey of requestedKeys) {
    const parsed = parseProtocolKey(requestedKey)
    if (parsed?.suffix === generated.suffix && sameRoute(parsed, binding))
      candidates.push({ key: requestedKey, parsed })
  }
  const exact = candidates.find((candidate) => candidate.parsed.base === generated.base)
  return (exact ?? candidates.toSorted((left, right) => left.key.localeCompare(right.key))[0])?.key
}

function parseProtocolKey(key: string): ParsedProtocolKey | undefined {
  const suffixStart = key.indexOf('#')
  const base = suffixStart < 0 ? key : key.slice(0, suffixStart)
  const separator = base.indexOf(':')
  if (separator <= 0) return undefined
  return {
    method: base.slice(0, separator),
    routeTemplate: base.slice(separator + 1),
    suffix: suffixStart < 0 ? '' : key.slice(suffixStart),
    base,
  }
}

function sameRoute(key: ParsedProtocolKey, binding: RouteBinding): boolean {
  return (
    key.method === binding.method &&
    routeShape(key.routeTemplate) === routeShape(binding.routeTemplate)
  )
}
