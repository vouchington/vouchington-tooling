import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateOutputPaths } from './output-paths.mts'

describe('validateOutputPaths', () => {
  it.each([
    ['/tmp/bundle', '/tmp/bundle'],
    ['/tmp/bundle', '/tmp/bundle/metadata'],
    ['/tmp/bundle/nested', '/tmp/bundle'],
    ['/tmp/bundle', '/tmp/.bundle.fetch-incomplete'],
  ])('rejects overlapping output paths %s and %s', (destination, metadata) => {
    expect(() => validateOutputPaths(destination, metadata)).toThrow(
      'destination and metadata overlap',
    )
  })

  it('accepts distinct normalized absolute paths', () => {
    expect(() =>
      validateOutputPaths(join('/tmp', 'bundle'), join('/tmp', 'metadata.json')),
    ).not.toThrow()
  })
})
