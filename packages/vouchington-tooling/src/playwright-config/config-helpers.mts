function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

export function withNodeOption(
  value: string | undefined,
  option: string,
  singletonPrefix?: string,
): string {
  const normalized = value?.trim()
  const escapedOption = escapeRegExp(option)
  const hasOption = new RegExp(`(^|\\s)${escapedOption}(?=\\s|$)`).test(normalized ?? '')
  const hasSingleton = singletonPrefix
    ? new RegExp(`(^|\\s)${escapeRegExp(singletonPrefix)}`).test(normalized ?? '')
    : false
  if (hasOption || hasSingleton) return normalized ?? ''
  return `${normalized ? `${normalized} ` : ''}${option}`
}

export function parseMaxWorkers(
  value: string | undefined,
  defaultWorkers: number | string,
): number | string {
  if (!value) return defaultWorkers
  if (/^[1-9]\d*%$/.test(value)) return value
  if (/^[1-9]\d*$/.test(value)) return Number(value)
  process.stderr.write(
    `Invalid PLAYWRIGHT_MAX_WORKERS value "${value}". Falling back to default: ${defaultWorkers}.\n`,
  )
  return defaultWorkers
}

export function assetHostResolverRule(
  assetPrefix: string | undefined,
  webPort: string,
): string | undefined {
  if (originOrFallback(assetPrefix ?? '', '') !== 'http://localhost') return undefined
  // Chromium-only: every current Playwright project uses CHROMIUM_USE, and port 80 is otherwise
  // unbound in CI, so only the build's asset URLs should reach the Next standalone server.
  return `--host-resolver-rules=MAP localhost:80 127.0.0.1:${webPort}`
}

export function originOrFallback(value: string, fallback: string): string {
  try {
    return new URL(value).origin
  } catch {
    return fallback
  }
}

export function withOptionalLaunchOptionArg<T>(
  base: T,
  userAgent: string,
  arg?: string,
): T & { userAgent: string; launchOptions?: { args?: string[] } } {
  const use = { ...base, userAgent }
  if (!arg) return use
  const launchOptions = (base as { launchOptions?: { args?: string[] } }).launchOptions
  return {
    ...use,
    launchOptions: {
      ...launchOptions,
      args: [...(launchOptions?.args ?? []), arg],
    },
  }
}
