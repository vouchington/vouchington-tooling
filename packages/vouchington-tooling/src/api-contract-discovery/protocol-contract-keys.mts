export function nextProtocolKey(contracts: ReadonlyMap<string, unknown>, key: string): string {
  if (!contracts.has(key)) return key
  let index = 2
  while (contracts.has(`${key}#protocol-${index}`)) index++
  return `${key}#protocol-${index}`
}
