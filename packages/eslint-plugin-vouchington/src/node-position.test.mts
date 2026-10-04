import { describe, expect, it } from 'vitest'
import { nodePosition } from './node-position.mts'

describe('node positions used to detect later writes', () => {
  it('uses range offsets when both adapter position shapes are present', () => {
    const node = { type: 'Identifier', range: [10, 20], start: 100, end: 200 }
    expect(nodePosition(node, false)).toBe(10)
    expect(nodePosition(node, true)).toBe(20)
  })

  it('preserves start/end offsets when an adapter omits a range', () => {
    const node = { type: 'Identifier', start: 10, end: 20 }
    expect(nodePosition(node, false)).toBe(10)
    expect(nodePosition(node, true)).toBe(20)
    expect(Number.isNaN(nodePosition({ type: 'Identifier' }, false))).toBe(true)
  })
})
