import type { Locator } from '@playwright/test'
import { describe, expect, it, vi } from 'vitest'
import { openRadixDropdown } from './radix-select.mts'

describe('openRadixDropdown', () => {
  it('presses Space on the trigger', async () => {
    const press = vi.fn<(key: string) => Promise<void>>(async () => undefined)
    const trigger = { press } as unknown as Locator

    await openRadixDropdown(trigger)

    expect(press).toHaveBeenCalledWith(' ')
  })
})
