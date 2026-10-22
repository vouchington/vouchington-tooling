import { describe, expect, it, vi } from 'vitest'

const remotes = vi.hoisted(() => vi.fn<() => string | undefined>())
vi.mock('./git-process.mts', () => ({
  gitRemoteVerbose: remotes,
  gitConfiguredRemoteDefaults: () => '',
}))

import { checkoutOwners } from './github-checkout-owners.mts'

describe('checkoutOwners remote lines', () => {
  it('reads fetch lines and skips push lines and partial-clone filters', () => {
    remotes.mockReturnValue(
      'origin\thttps://github.com/Acme/t.git (fetch) [blob:none]\norigin\thttps://github.com/other/t.git (push)\n',
    )
    expect(checkoutOwners('/x')).toEqual(new Set(['acme']))
  })

  it('is undefined for a line it does not recognize or when git cannot answer', () => {
    remotes.mockReturnValue('garbage without a tab\n')
    expect(checkoutOwners('/x')).toBeUndefined()
    remotes.mockReturnValue(undefined)
    expect(checkoutOwners('/x')).toBeUndefined()
  })
})
