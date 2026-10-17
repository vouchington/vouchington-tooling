import { describe, expect, it } from 'vitest'

import { ghSpawnEnv } from './env.mts'

describe('ghSpawnEnv', () => {
  it('removes CLICOLOR_FORCE and passes every other variable through', () => {
    const input = { CLICOLOR_FORCE: '1', NO_COLOR: '1', PATH: '/bin', GH_TOKEN: 't' }
    expect(ghSpawnEnv(input)).toEqual({ NO_COLOR: '1', PATH: '/bin', GH_TOKEN: 't' })
    expect(input.CLICOLOR_FORCE).toBe('1')
  })

  it('leaves an environment without CLICOLOR_FORCE unchanged', () => {
    expect(ghSpawnEnv({ A: '1' })).toEqual({ A: '1' })
  })

  it('defaults to the current process environment', () => {
    expect(ghSpawnEnv()).not.toHaveProperty('CLICOLOR_FORCE')
  })
})
