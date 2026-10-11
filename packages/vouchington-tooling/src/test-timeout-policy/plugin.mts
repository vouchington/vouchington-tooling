import type { Reporter } from 'vitest/node'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface NodeRunnerPolicy {
  /** Absolute resolved final custom runner module, or null for native TestRunner. */
  runner: string | null
}

type OptimizerConfig = { include?: string[]; exclude?: string[] }
type BrowserConfig = {
  optimizeDeps?: OptimizerConfig
  environments?: { client?: { optimizeDeps?: OptimizerConfig } }
}
type BrowserOptimizationProject = {
  viteConfig: BrowserConfig
  vite: {
    config: BrowserConfig
    environments: { client?: { config: BrowserConfig } }
  }
}

const virtualId = '\0test-timeout-policy:vitest'

/** Vite resolves the public imports; no source parser or SDK-private patch is involved. */
export function testTimeoutPolicyPlugin(
  maximum = 30_000,
  registrationPackages: readonly string[] = [],
  nodeRunner?: NodeRunnerPolicy,
) {
  if (!Number.isFinite(maximum) || maximum <= 0)
    throw new RangeError('Timeout maximum must be positive and finite')
  const policy = fileURLToPath(new URL('./index.mjs', import.meta.url))
  const runnerId = fileURLToPath(new URL('./timeout-policy-virtual-runner.mjs', import.meta.url))
  const originalRunner = nodeRunner?.runner
  if (originalRunner && !isAbsolute(originalRunner))
    throw new TypeError('Supply the absolute resolved final runner module')
  return {
    name: 'test-timeout-policy',
    enforce: 'pre' as const,
    // Externalized modules bypass Vite resolution entirely; registration helpers must be inlined.
    config(config: { test?: { runner?: string } } = {}) {
      if (nodeRunner && config.test?.runner && config.test.runner !== originalRunner)
        throw new Error('Configured runner differs from the supplied final runner')
      return {
        test: {
          ...(nodeRunner ? { runner: runnerId } : {}),
          server: { deps: { inline: [...registrationPackages] } },
        },
      }
    },
    configResolved(config: { test?: { runner?: string; browser?: { enabled?: boolean } } }) {
      if (!nodeRunner) return
      if (config.test?.browser?.enabled)
        throw new Error('Node final-runner composition cannot be used for browser projects')
      if (config.test?.runner !== runnerId)
        throw new Error('Final runner policy was replaced during configuration merge')
    },
    resolveId(source: string, importer?: string) {
      if (nodeRunner && source === runnerId) return runnerId
      if (source === 'vitest' && importer === runnerId) return null
      if (source !== 'vitest' || !importer || importer === virtualId) return null
      return virtualId
    },
    load(id: string) {
      if (nodeRunner && id === runnerId)
        return `
        ${
          originalRunner
            ? `import FinalRunner from ${JSON.stringify(originalRunner)}`
            : "import { TestRunner as FinalRunner } from 'vitest'"
        }
        import { guardPublicRunner, protectRunnerTimeouts } from ${JSON.stringify(policy)}
        export default guardPublicRunner(FinalRunner, ${JSON.stringify(maximum)}, protectRunnerTimeouts)
      `
      if (id !== virtualId) return null
      return `
        import * as native from 'vitest'
        import { guardVitestExports } from ${JSON.stringify(policy)}
        export * from 'vitest'
        const guarded = guardVitestExports(native, ${JSON.stringify(maximum)})
        ${nodeRunner ? "export { TestRunner } from 'vitest'" : 'export const TestRunner = guarded.TestRunner'}
        export const { test, it, describe, suite, beforeAll, beforeEach, afterAll, afterEach,
          aroundAll, aroundEach, onTestFailed, onTestFinished, vi, vitest } = guarded
      `
    },
  }
}

/** Browser-only candidate: keep public constructor/registrars out of dependency bundles. */
export function browserTestTimeoutPolicyPlugin(
  maximum = 30_000,
  registrationPackages: readonly string[] = [],
) {
  const base = testTimeoutPolicyPlugin(maximum, registrationPackages)
  const excluded = ['vitest', '@vitest/browser', ...registrationPackages]
  const filterIncludes = (include: string[]) =>
    include.filter(
      (entry) =>
        !entry.split('>').some((part) => {
          const token = part.trim()
          return excluded.some((id) => token === id || token.startsWith(`${id}/`))
        }),
    )
  return {
    ...base,
    name: 'browser-test-timeout-policy',
    configEnvironment: {
      order: 'post' as const,
      handler(
        name: string,
        config: { consumer?: string; optimizeDeps?: { include?: string[]; exclude?: string[] } },
      ) {
        if (name !== 'client' && config.consumer !== 'client') return
        return {
          optimizeDeps: {
            ...config.optimizeDeps,
            include: filterIncludes(config.optimizeDeps?.include ?? []),
            exclude: [...new Set([...(config.optimizeDeps?.exclude ?? []), ...excluded])],
          },
        }
      },
    },
    config(config: { test?: { reporters?: string | (string | Reporter)[] } } = {}) {
      const existing = config.test?.reporters
      const reporters =
        existing === undefined ? ['default'] : Array.isArray(existing) ? existing : [existing]
      const lifecycle = {
        onBrowserInit(project: BrowserOptimizationProject) {
          // Public reporter lifecycle runs before the provider starts browser pages.
          const configs = [project.viteConfig, project.vite.config]
          for (const resolved of configs) {
            for (const optimizer of [
              resolved.optimizeDeps,
              resolved.environments?.client?.optimizeDeps,
            ]) {
              if (optimizer?.include) optimizer.include = filterIncludes(optimizer.include)
            }
          }
          const optimizer = project.vite.environments.client?.config.optimizeDeps
          if (optimizer?.include) optimizer.include = filterIncludes(optimizer.include)
        },
      }
      return {
        ...base.config(),
        test: { ...base.config().test, reporters: [...reporters, lifecycle] },
        optimizeDeps: { exclude: excluded },
      }
    },
    configResolved(config: {
      test?: { browser?: { enabled?: boolean } }
      optimizeDeps?: { include?: string[]; exclude?: string[] }
      environments?: { client?: { optimizeDeps?: { include?: string[]; exclude?: string[] } } }
    }) {
      if (!config.test?.browser?.enabled)
        throw new Error('Browser timeout policy requires an enabled browser project')
      for (const id of excluded) {
        if (!config.optimizeDeps?.exclude?.includes(id))
          throw new Error(`Missing browser timeout routing exclusion: ${id}`)
      }
      for (const optimizer of [config.optimizeDeps, config.environments?.client?.optimizeDeps]) {
        if (optimizer?.include) optimizer.include = filterIncludes(optimizer.include)
      }
    },
  }
}
