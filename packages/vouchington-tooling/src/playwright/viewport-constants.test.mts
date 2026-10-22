import { describe, expect, it } from 'vitest'
import { DESKTOP_VIEWPORT, MOBILE_VIEWPORTS } from './viewport-constants.mts'

describe('viewport constants', () => {
  it('lists the mobile sizes and the desktop size', () => {
    expect(MOBILE_VIEWPORTS).toEqual({
      'iphone-se': { width: 375, height: 667 },
      'iphone-14-pro': { width: 393, height: 852 },
      'pixel-7': { width: 412, height: 915 },
      'iphone-14-plus': { width: 428, height: 926 },
      'galaxy-s21': { width: 360, height: 800 },
      smallest: { width: 320, height: 568 },
    })
    expect(DESKTOP_VIEWPORT).toEqual({ width: 1280, height: 720 })
  })
})
