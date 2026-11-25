import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCrossProcessConcurrencyLimiter } from './concurrency-broker.mts'
import type { TracedRequest } from './trace-proxy.mts'

/** Minimal cookie jar for Fetch-based web integration clients. */
export class WebIntegrationCookies {
  private readonly cookies = new Map<string, string>()

  captureSetCookies(response: Response): void {
    const setCookies = getSetCookieHeaders(response.headers)

    for (const header of setCookies) {
      const [cookiePart] = header.split(';')
      const separatorIndex = cookiePart!.indexOf('=')
      if (separatorIndex === -1) continue

      const name = cookiePart!.slice(0, separatorIndex)
      const value = cookiePart!.slice(separatorIndex + 1)

      if (value) {
        this.cookies.set(name, value)
      } else {
        this.cookies.delete(name)
      }
    }
  }

  clear(): void {
    this.cookies.clear()
  }

  get(name: string): string | undefined {
    return this.cookies.get(name)
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value)
  }

  toHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')
  }
}

function getSetCookieHeaders(headers: Headers): string[] {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()
  }

  const single = headers.get('set-cookie')
  return single ? splitCombinedSetCookieHeader(single) : []
}

function splitCombinedSetCookieHeader(header: string): string[] {
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]+)/).map((part) => part.trim())
}

/** Writes a JSON integration artifact under `artifactsDir` using a filesystem-safe filename. */
export async function writePageArtifact(
  artifactsDir: string,
  name: string,
  data: unknown,
): Promise<void> {
  await mkdir(artifactsDir, { recursive: true })
  await writeFile(
    join(artifactsDir, `${sanitizeFileName(name)}.json`),
    JSON.stringify(data, null, 2),
  )
}

export interface PrintTraceOptions {
  verbose?: boolean
  verboseEnvVar?: string
  label?: string
  write?: (chunk: string) => void
}

/** Prints a formatted backend request trace when verbose mode is enabled. */
export function printTrace(
  path: string,
  tracedRequests: readonly TracedRequest[],
  options: PrintTraceOptions = {},
): void {
  const verbose =
    options.verbose ?? process.env[options.verboseEnvVar ?? 'WEB_INTEGRATION_VERBOSE'] === '1'
  if (!verbose) return
  const label = options.label ?? '[web-integration]'
  const write =
    options.write ??
    ((chunk: string) => {
      process.stdout.write(chunk)
    })
  const lines = tracedRequests.length
    ? tracedRequests.map(
        (request) =>
          `  ${request.method} ${request.path} -> ${request.status} (${request.durationMs}ms)`,
      )
    : ['  (no backend requests)']
  write(`\n${label} API trace for ${path}\n${lines.join('\n')}\n`)
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export interface AssetMetadata {
  status: number
  contentType: string | null
}

export interface AssetMetadataCacheOptions {
  /** Origin hosting the asset concurrency broker, or a custom limiter function. */
  traceOrigin?: string
  limiter?: <T>(fn: () => Promise<T>) => Promise<T>
  /** Decides whether a URL pathname is immutable/content-hashed and safe to cache. Defaults to `/_next/static/`. */
  isCacheablePath?: (pathname: string) => boolean
}

/**
 * Creates a bounded-concurrency asset metadata fetcher that collapses concurrent requests for
 * content-hashed static assets and evicts failed or >=400 responses.
 */
export function createAssetMetadataCache(options: AssetMetadataCacheOptions) {
  const cache = new Map<string, Promise<AssetMetadata>>()
  const isCacheablePath =
    options.isCacheablePath ?? ((pathname: string) => pathname.startsWith('/_next/static/'))
  const runLimited =
    options.limiter ??
    (() => {
      if (!options.traceOrigin) {
        throw new Error('Asset metadata cache requires either traceOrigin or limiter')
      }
      return createCrossProcessConcurrencyLimiter(options.traceOrigin)
    })()

  return function fetchAssetMetadataCached(
    url: string,
    fetchAsset: (url: string) => Promise<Response>,
  ): Promise<AssetMetadata> {
    const cacheable = isCacheablePath(new URL(url, 'http://localhost').pathname)
    const cached = cacheable ? cache.get(url) : undefined
    if (cached) return cached

    const pending = runLimited(async () => {
      const response = await fetchAsset(url)
      await response.arrayBuffer()
      return { status: response.status, contentType: response.headers.get('content-type') }
    })
    if (cacheable) cache.set(url, pending)
    void pending.then(
      (metadata) => {
        if (metadata.status >= 400) cache.delete(url)
      },
      () => cache.delete(url),
    )
    return pending
  }
}
