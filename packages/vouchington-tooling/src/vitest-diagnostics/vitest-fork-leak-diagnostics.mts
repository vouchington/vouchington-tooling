import type { ForkLeakVerdict } from './vitest-fork-leak-detection.mts'

/** Formats a bounded, single-line verdict for a test failure or diagnostic log. */
export function formatForkLeakDiagnostics(verdict: ForkLeakVerdict): string {
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
