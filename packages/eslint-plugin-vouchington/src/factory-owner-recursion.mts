import type { VariableLike } from './ast-helpers.mts'

export function withActiveVariable<T>(
  variable: VariableLike,
  active: Set<VariableLike>,
  visit: () => T,
): T {
  active.add(variable)
  try {
    return visit()
  } finally {
    active.delete(variable)
  }
}
