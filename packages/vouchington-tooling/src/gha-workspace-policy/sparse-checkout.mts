import { visitRunSteps, type GhaFileKind } from './shared.mts'

const SPARSE_CHECKOUT_KEYS = ['sparse-checkout', 'sparse-checkout-cone-mode']
const SPARSE_CHECKOUT_COMMANDS = [
  /\bgit\b[^\n;&|]*\bsparse-checkout\s+(?:init|set|add|reapply)\b/iu,
  /\bgit\b[^\n;&|]*\bconfig\b[^\n;&|]*\bcore\.sparseCheckout(?:Cone)?(?:\s*=\s*|\s+)(?:"|')?(?:true|yes|on|1)(?:"|')?(?=\s|;|$)/iu,
]

export function checkNoSparseCheckoutDocument(
  file: string,
  document: unknown,
  kind: GhaFileKind,
  errors: string[],
): void {
  visitRunSteps(document, kind === 'action', (scope, index, step) => {
    const run = step.run
    const normalizedRun = typeof run === 'string' ? run.replace(/\\\r?\n\s*/gu, ' ') : ''
    if (SPARSE_CHECKOUT_COMMANDS.some((pattern) => pattern.test(normalizedRun))) {
      errors.push(
        `::error file=${file}::${file}: ${scope} step ${index} enables sparse checkout. ` +
          'Use a full checkout; commands that disable or unset sparse-checkout state remain allowed.',
      )
    }
    if (typeof step.uses !== 'string' || !step.uses.startsWith('actions/checkout@')) return
    const withValue = step.with
    if (!withValue || typeof withValue !== 'object') return
    for (const key of SPARSE_CHECKOUT_KEYS) {
      if (!(key in withValue)) continue
      errors.push(
        `::error file=${file}::${file}: ${scope} step ${index} passes "${key}" to ` +
          'actions/checkout. Persistent runners reuse workspace directories, so leaked ' +
          'sparse-checkout state can silently narrow a later checkout. Check out the full tree.',
      )
    }
  })
}
