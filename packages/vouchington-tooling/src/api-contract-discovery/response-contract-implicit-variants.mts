import type { BackendResponseContract } from './response-contract-types.mts'

export function nextImplicitVariantKey(
  contracts: Map<string, BackendResponseContract>,
  key: string,
): string {
  let suffix = 2
  while (contracts.has(`${key}#implicit-${suffix}`)) suffix++
  return `${key}#implicit-${suffix}`
}
