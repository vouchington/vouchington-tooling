import type { Plugin } from 'vitest/config'

export const DEFAULT_EFFECTIVE_TIMEOUT_MS = 30_000
export const DEFAULT_EFFECTIVE_TIMEOUT_PLUGIN = 'effective-test-timeout-cap'
const MIN_FIXTURE_TIMEOUT_MS = 5_000

export type EffectiveTimeoutCapOptions = {
  maxTimeoutMs?: number
  name?: string
}

export function assertEffectiveTimeoutCap(maxTimeoutMs: number): number {
  if (!Number.isFinite(maxTimeoutMs) || maxTimeoutMs < MIN_FIXTURE_TIMEOUT_MS) {
    throw new RangeError(
      `effective timeout cap must be finite and at least ${MIN_FIXTURE_TIMEOUT_MS}ms; received ${maxTimeoutMs}`,
    )
  }
  return maxTimeoutMs
}

// Validate selected projects after framework normalization, before global setup imports.
export function effectiveTimeoutCap(options: EffectiveTimeoutCapOptions = {}): Plugin {
  const maxTimeoutMs = assertEffectiveTimeoutCap(
    options.maxTimeoutMs ?? DEFAULT_EFFECTIVE_TIMEOUT_MS,
  )
  const name = options.name ?? DEFAULT_EFFECTIVE_TIMEOUT_PLUGIN
  return {
    name,
    configureVitest({ project }) {
      for (const field of ['testTimeout', 'hookTimeout'] as const) {
        const value = project.config[field]
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value <= 0 ||
          value > maxTimeoutMs
        ) {
          throw new RangeError(
            `Project ${project.config.name}: effective ${field} must be finite, positive, and at most ${maxTimeoutMs}ms; received ${value}`,
          )
        }
      }
    },
  }
}
