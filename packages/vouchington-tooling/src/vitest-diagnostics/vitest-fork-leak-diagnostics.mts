import type { ForkLeakVerdict } from './vitest-fork-leak-detection.mts'
import type { PoolConnectionMetrics, PoolMetrics } from './vitest-fork-leak-handshake-samples.mts'
import { formatResourceCounts } from './vitest-process-resources.mts'

type ForkLeakGrowthStep = NonNullable<ForkLeakVerdict['suspectedGrowth']>
type PoolMetricsProvider = () => PoolMetrics
type PoolSocketHandles = { active: ReadonlySet<object>; owned: ReadonlySet<object> }

const POOL_METRICS_KEY = Symbol.for('vitest-fork-leak-pool-metrics')
const POOL_SOCKETS_KEY = Symbol.for('vitest-fork-leak-pool-socket-handles')

export function getRegisteredPoolMetrics(): PoolMetrics | null {
  const provider = (
    globalThis as typeof globalThis & Record<symbol, PoolMetricsProvider | undefined>
  )[POOL_METRICS_KEY]
  return provider?.() ?? null
}

export function getRegisteredPoolSocketHandles(): PoolSocketHandles | null {
  const provider = (
    globalThis as typeof globalThis & Record<symbol, (() => PoolSocketHandles) | undefined>
  )[POOL_SOCKETS_KEY]
  return provider?.() ?? null
}

const DEFAULT_POOL_METRICS_LABEL = 'pool metrics:'

export type ForkLeakDiagnosticsOptions = {
  /** Text printed before the pool metrics line. Defaults to `pool metrics:`. */
  poolMetricsLabel?: string
}

/**
 * One-line summary, or a multi-line report when resource counts are supplied. The multi-line
 * report ends with a pool metrics line whose label comes from `options.poolMetricsLabel`.
 */
export function formatForkLeakDiagnostics(verdict: ForkLeakVerdict): string
export function formatForkLeakDiagnostics(
  verdict: ForkLeakVerdict,
  counts: ReadonlyMap<string, number>,
  poolMetrics?: PoolMetrics | null,
  options?: ForkLeakDiagnosticsOptions,
): string
export function formatForkLeakDiagnostics(
  verdict: ForkLeakVerdict,
  counts?: ReadonlyMap<string, number>,
  poolMetrics?: PoolMetrics | null,
  options: ForkLeakDiagnosticsOptions = {},
): string {
  if (counts === undefined) return formatForkLeakSummary(verdict)
  return [
    '[vitest-fork-leak]',
    `type: ${verdict.type}`,
    `baseline: ${verdict.baseline}`,
    `current: ${verdict.current} (+${verdict.current - verdict.baseline})`,
    `candidate evidence span: ${verdict.streak}`,
    `candidate growth evidence: ${verdict.growthCheckpoints} (required: ${verdict.requiredGrowthCheckpoints})`,
    `confirmed by continuation in file: ${verdict.detectedInFile ?? 'unknown'}`,
    `suspected growth file: ${verdict.suspectedGrowth?.testFile ?? 'unknown'}`,
    `largest growth step: ${formatGrowthStep(verdict.suspectedGrowth)}`,
    `tracked resource counts: ${formatResourceCounts(counts)}`,
    `${options.poolMetricsLabel ?? DEFAULT_POOL_METRICS_LABEL} ${formatPoolMetrics(poolMetrics ?? null)}`,
  ].join('\n')
}

function formatForkLeakSummary(verdict: ForkLeakVerdict): string {
  const growth = verdict.suspectedGrowth
  const file = growth?.testFile ?? verdict.detectedInFile ?? 'unknown'
  return [
    `[vitest-fork-leak] type=${verdict.type}`,
    `baseline=${verdict.baseline}`,
    `current=${verdict.current}`,
    `streak=${verdict.streak}`,
    `growth=${verdict.growthCheckpoints}/${verdict.requiredGrowthCheckpoints}`,
    `file=${file.replace(/\s+/g, ' ').slice(0, 240)}`,
    `delta=${growth?.delta ?? 0}`,
  ].join(' ')
}

function formatPoolMetrics(metrics: PoolMetrics | null): string {
  if (!metrics) return 'unavailable (pools not initialized)'
  return Object.entries(metrics)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([label, pool]) => formatPool(label, pool))
    .join(' ')
}

function formatPool(label: string, pool: PoolConnectionMetrics): string {
  return `${label}(total=${pool.total},idle=${pool.idle},non-idle-or-connecting=${pool.nonIdleOrConnecting},waiting=${pool.waiting})`
}

function formatGrowthStep(step: ForkLeakGrowthStep | null): string {
  return step ? `${step.previous} -> ${step.current} (+${step.delta})` : 'unknown'
}
