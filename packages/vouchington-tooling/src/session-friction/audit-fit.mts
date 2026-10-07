import type { AuditRedactor } from './text.mts'

export type AuditRender = { redact?: AuditRedactor | undefined; budgetBytes?: number }

const ELLIPSIS = '…'

function bytes(value: string): number {
  return Buffer.byteLength(value)
}

/** Joins escaped units, or cuts on a unit boundary and marks the cut when over `maxBytes`. */
function fitUnits(units: string[], maxBytes: number): string {
  const whole = units.join('')
  if (bytes(whole) <= maxBytes) return whole
  let used = bytes(ELLIPSIS)
  let kept = ''
  for (const unit of units) {
    used += bytes(unit)
    if (used > maxBytes) break
    kept += unit
  }
  return `${kept.trimEnd()}${ELLIPSIS}`
}

/**
 * Renders fields whole while they fit in `budgetBytes` (minus the fixed `overheadBytes`). When they
 * do not, shorter fields keep their full length and the longest ones share what remains.
 */
export function fitFields(
  fields: string[][],
  overheadBytes: number,
  budgetBytes: number,
): string[] {
  const sizes = fields.map((units) => bytes(units.join('')))
  let left = budgetBytes - overheadBytes
  if (sizes.reduce((sum, size) => sum + size, 0) <= left)
    return fields.map((units) => units.join(''))
  const caps = [...sizes]
  const order = sizes.map((_, index) => index).sort((a, b) => sizes[a]! - sizes[b]!)
  order.forEach((index, rank) => {
    caps[index] = Math.min(sizes[index]!, Math.floor(left / (order.length - rank)))
    left -= caps[index]!
  })
  return fields.map((units, index) => fitUnits(units, caps[index]!))
}
