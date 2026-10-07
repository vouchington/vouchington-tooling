import { fitUnits, type AuditRedactor } from './text.mts'

export type AuditRender = {
  redact?: AuditRedactor | undefined
  budgetBytes?: number
  /** Field indexes that may be cut, least important first; other fields are never cut. */
  shrinkOrder?: readonly number[]
}

const MIN_FIELD_BYTES = Buffer.byteLength('…')

export function byteLength(value: string): number {
  return Buffer.byteLength(value)
}

/**
 * Renders fields whole while they fit in `budgetBytes` (minus the fixed `overheadBytes`). When they
 * do not, only the `shrinkOrder` fields are cut, in that order, each down to at most a cut marker,
 * and only at token boundaries. The result can still exceed the budget if the fields cannot shrink
 * enough; callers check the size.
 */
export function fitFields(
  fields: string[][],
  overheadBytes: number,
  budgetBytes: number,
  shrinkOrder: readonly number[],
): string[] {
  const sizes = fields.map((units) => byteLength(units.join('')))
  let excess = sizes.reduce((sum, size) => sum + size, overheadBytes) - budgetBytes
  const caps = [...sizes]
  for (const index of shrinkOrder) {
    if (excess <= 0) break
    const cut = Math.min(excess, Math.max(0, sizes[index]! - MIN_FIELD_BYTES))
    caps[index] = sizes[index]! - cut
    excess -= cut
  }
  return fields.map((units, index) =>
    caps[index] === sizes[index] ? units.join('') : fitUnits(units, caps[index]!),
  )
}

/**
 * Renders every item whole when together they fit `totalBytes`. Otherwise renders the largest
 * leading run of items that each fit an equal share of what remains after `reserveBytes` (for the
 * omission note), and reports how many were left out. Never renders more than the total allows.
 * A share below `minShareBytes` would leave only stubs, so fewer items are kept instead.
 */
export function selectWithin<T>(
  items: T[],
  totalBytes: number,
  reserveBytes: number,
  separatorBytes: number,
  minShareBytes: number,
  render: (item: T, shareBytes: number) => string,
): { rendered: string[]; omitted: number } {
  const whole = items.map((item) => render(item, Infinity))
  if (byteLength(whole.join('')) + separatorBytes * Math.max(0, whole.length - 1) <= totalBytes)
    return { rendered: whole, omitted: 0 }
  const available = totalBytes - reserveBytes
  const renderRun = (count: number): { rendered: string[]; fits: boolean } => {
    const share = Math.floor((available - separatorBytes * (count - 1)) / count)
    const rendered = items.slice(0, count).map((item) => render(item, share))
    const fits = share >= minShareBytes && rendered.every((line) => byteLength(line) <= share)
    return { rendered, fits }
  }
  let low = 0
  let high = items.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (renderRun(middle).fits) low = middle
    else high = middle - 1
  }
  return { rendered: low === 0 ? [] : renderRun(low).rendered, omitted: items.length - low }
}
