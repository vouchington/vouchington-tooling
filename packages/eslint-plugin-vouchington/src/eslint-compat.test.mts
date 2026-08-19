import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import plugin from './index.mts'

describe('eslint compatibility', () => {
  it('loads as an ESLint plugin with no rules enabled', async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ['**/*.js'],
          plugins: { vouchington: plugin as ESLint.Plugin },
        },
      ],
    })
    const [result] = await eslint.lintText('const value = 1\n', { filePath: 'fixture.js' })
    expect(result?.errorCount).toBe(0)
    expect(result?.messages).toEqual([])
  })
})
