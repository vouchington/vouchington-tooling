import { fileURLToPath } from 'node:url'

const virtualId = '\0test-timeout-policy:vitest'

/** Vite resolves the public imports; no source parser or SDK-private patch is involved. */
export function testTimeoutPolicyPlugin(
  maximum = 30_000,
  registrationPackages: readonly string[] = [],
) {
  if (!Number.isFinite(maximum) || maximum <= 0)
    throw new RangeError('Timeout maximum must be positive and finite')
  const policy = fileURLToPath(new URL('./index.mjs', import.meta.url))
  return {
    name: 'test-timeout-policy',
    enforce: 'pre' as const,
    // Externalized modules bypass Vite resolution entirely; registration helpers must be inlined.
    config() {
      return { test: { server: { deps: { inline: [...registrationPackages] } } } }
    },
    resolveId(source: string, importer?: string) {
      if (source !== 'vitest' || !importer || importer === virtualId) return null
      return virtualId
    },
    load(id: string) {
      if (id !== virtualId) return null
      return `
        import * as native from 'vitest'
        import { guardVitestExports } from ${JSON.stringify(policy)}
        export * from 'vitest'
        const guarded = guardVitestExports(native, ${JSON.stringify(maximum)})
        export const { test, it, describe, suite, beforeAll, beforeEach, afterAll, afterEach,
          aroundAll, aroundEach, onTestFailed, onTestFinished, vi, vitest } = guarded
      `
    },
  }
}
