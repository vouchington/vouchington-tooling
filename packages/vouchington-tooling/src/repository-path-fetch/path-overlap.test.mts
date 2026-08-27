import { posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pathsOverlap } from './path-overlap.mts'

describe('pathsOverlap', () => {
  it.each([
    ['/tmp/bundle', '/tmp/bundle/metadata.json', posix],
    ['/tmp/bundle', '/tmp/bundle', posix],
    ['C:\\temp\\bundle', 'C:\\temp\\bundle\\metadata.json', win32],
    ['C:\\Temp\\Bundle', 'c:\\temp\\bundle', win32],
  ])('detects overlapping paths %s and %s', (left, right, operations) => {
    expect(pathsOverlap(left, right, operations)).toBe(true)
  })

  it.each([
    ['/tmp/bundle', '/tmp/bundle.json', posix],
    ['C:\\temp\\bundle', 'C:\\temp\\bundle.json', win32],
    ['C:\\temp\\bundle', 'D:\\temp\\bundle', win32],
  ])('keeps distinct paths %s and %s separate', (left, right, operations) => {
    expect(pathsOverlap(left, right, operations)).toBe(false)
  })
})
