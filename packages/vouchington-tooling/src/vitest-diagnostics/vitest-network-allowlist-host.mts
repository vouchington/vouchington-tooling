export function normalizeHost(host: string): string {
  let value = host.trim().toLowerCase()
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  if (value.endsWith('.')) value = value.slice(0, -1)
  return value
}

function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::' || host === '::1' || host === '0:0:0:0:0:0:0:1' || host === '0.0.0.0')
    return true
  if (host.startsWith('::ffff:')) return isLoopbackHost(host.slice('::ffff:'.length))
  const parts = host.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false
  const octets = parts.map(Number)
  return octets[0] === 127 && octets.every((part) => part <= 255)
}

export type HostAllowlist = {
  isExempt: () => boolean
  allowedHosts: ReadonlySet<string>
  allowedIps: ReadonlySet<string>
}

export function isAllowedHost(host: string, current: HostAllowlist): boolean {
  if (current.isExempt()) return true
  const normalized = normalizeHost(host)
  return (
    current.allowedHosts.has(normalized) ||
    isLoopbackHost(normalized) ||
    current.allowedIps.has(normalized)
  )
}

export function rememberAddresses(value: unknown, ips: Set<string>): void {
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      if (item.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(item)) ips.add(normalizeHost(item))
      return
    }
    if (Array.isArray(item)) {
      for (const entry of item) visit(entry)
      return
    }
    if (typeof item === 'object' && item !== null && 'address' in item) {
      visit((item as { address: unknown }).address)
    }
  }
  visit(value)
}
