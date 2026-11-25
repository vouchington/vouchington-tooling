import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { vi } from 'vitest'
import type { ManagedProcess } from './exit-diagnostics.mts'
import type { ReservedPort } from './ports.mts'
import { startManagedProcess, type StartManagedProcessOptions } from './processes.mts'

/** Releases a reserved port and immediately spawns the managed process that binds it. */
export async function startReservedProcess(
  reservation: ReservedPort,
  processes: ManagedProcess[],
  options: StartManagedProcessOptions,
): Promise<ManagedProcess> {
  await reservation.release()
  const managedProcess = startManagedProcess(options)
  processes.push(managedProcess)
  return managedProcess
}

export interface RequiredArtifactPath {
  label: string
  path: string
}

/** Verifies that every required prebuilt path exists before starting integration services. */
export function ensureRequiredPathsExist(
  requiredPaths: readonly RequiredArtifactPath[],
  options: { prefix?: string; hint?: string } = {},
): void {
  const missingPaths = requiredPaths.filter((entry) => !existsSync(entry.path))
  if (missingPaths.length === 0) return

  const prefix = options.prefix ?? '[integration]'
  const missingSummary = missingPaths.map((entry) => `${entry.label}: ${entry.path}`).join('\n')
  const hint = options.hint ? `\n${options.hint}` : ''
  throw new Error(`${prefix} Missing required build artifacts.\n${missingSummary}${hint}`)
}

export interface FileRestoration {
  path: string
  existingContent: string | null
}

export interface CleanupManagedServicesOptions {
  processes: readonly ManagedProcess[]
  reservedPorts: readonly ReservedPort[]
  closeables?: ReadonlyArray<{ close: () => Promise<void> }>
  filesToRestore?: readonly FileRestoration[]
}

/** Stops managed processes in reverse order, releases ports, closes proxies, and restores files. */
export async function cleanupManagedServices(
  options: CleanupManagedServicesOptions,
): Promise<void> {
  await Promise.allSettled(options.processes.toReversed().map((managed) => managed.stop()))
  await Promise.allSettled(options.reservedPorts.map((reservation) => reservation.release()))
  await Promise.allSettled((options.closeables ?? []).map((item) => item.close()))

  for (const file of options.filesToRestore ?? []) {
    if (file.existingContent === null) {
      rmSync(file.path, { force: true })
    } else {
      writeFileSync(file.path, file.existingContent)
    }
  }
}

export interface WebApiTestServer {
  close: (callback: () => void) => void
}

export interface WebApiClientRuntimeRestore {
  backendServer: WebApiTestServer
  previousFetch: typeof globalThis.fetch
}

/** Closes an in-process HTTP test server and restores stubbed Vitest env/globals and `fetch`. */
export async function closeWebApiClientRuntime(state: WebApiClientRuntimeRestore): Promise<void> {
  await new Promise<void>((resolve) => {
    state.backendServer.close(() => resolve())
  })
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  globalThis.fetch = state.previousFetch
}

/** Runs `run` with a stubbed `window` global and active client-runtime cookie state. */
export async function withWebApiClientRuntime<T>(options: {
  cookieHeader?: { Cookie?: string }
  setActive: (active: boolean, cookie: string | undefined) => void
  run: () => Promise<T>
}): Promise<T> {
  options.setActive(true, options.cookieHeader?.Cookie)
  vi.stubGlobal('window', {})
  try {
    return await options.run()
  } finally {
    options.setActive(false, undefined)
    vi.unstubAllGlobals()
  }
}

export interface LoopbackClientFetchOptions {
  baseUrl: string
  previousFetch: typeof globalThis.fetch
  isActive: () => boolean
  getCookie: () => string | undefined
  buildHeaders?: (initHeaders?: RequestInit['headers']) => Headers
  extraHeader?: { name: string; value: string | undefined; mode?: 'always' | 'with-cookie' }
}

/**
 * Builds a `fetch` wrapper that rewrites relative `/...` URLs against `baseUrl` while the client
 * runtime is active, injecting optional proxy headers, cookies, and `Origin` for non-GET calls.
 */
export function createLoopbackClientFetch(
  options: LoopbackClientFetchOptions,
): typeof globalThis.fetch {
  return (input, init) => {
    if (!options.isActive() || typeof input !== 'string' || !input.startsWith('/')) {
      return options.previousFetch(input, init)
    }
    const headers = options.buildHeaders
      ? options.buildHeaders(init?.headers)
      : new Headers(init?.headers)
    const cookie = options.getCookie()
    const extra = options.extraHeader
    if (extra?.value && (extra.mode ?? 'always') === 'always') {
      headers.set(extra.name, extra.value)
    }
    if (cookie) {
      headers.set('Cookie', cookie)
      if (extra?.value && extra.mode === 'with-cookie') {
        headers.set(extra.name, extra.value)
      }
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        headers.set('Origin', options.baseUrl)
      }
    }
    return options.previousFetch(`${options.baseUrl}${input}`, { ...init, headers })
  }
}
