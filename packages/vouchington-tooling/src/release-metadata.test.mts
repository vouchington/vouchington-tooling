import { describe, expect, it } from 'vitest'

import { verifyReleaseMetadata } from '../../../scripts/verify-release-metadata.mts'

describe('verifyReleaseMetadata', () => {
  it('accepts an already-published artifact from the selected merge', () => {
    expect(() =>
      verifyReleaseMetadata({ version: '1.2.3', gitHead: 'a'.repeat(40) }, '1.2.3', 'a'.repeat(40)),
    ).not.toThrow()
  })

  it.each([
    [{ version: '1.2.2', gitHead: 'a'.repeat(40) }, 'version'],
    [{ version: '1.2.3', gitHead: 'b'.repeat(40) }, 'gitHead'],
    [{ version: '1.2.3' }, 'gitHead'],
  ])('rejects mismatched published %s metadata', (metadata, field) => {
    expect(() => verifyReleaseMetadata(metadata, '1.2.3', 'a'.repeat(40))).toThrow(field)
  })
})
