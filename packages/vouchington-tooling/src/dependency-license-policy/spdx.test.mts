import { describe, expect, it } from 'vitest'

import { collectSpdxAtoms, evaluateSpdxExpression, parseSpdxExpression } from './spdx.mts'

describe('SPDX expressions', () => {
  it('parses atoms, operators, suffixes, and exceptions', () => {
    expect(parseSpdxExpression('MIT')).toEqual({ type: 'ATOM', id: 'MIT' })
    expect(parseSpdxExpression('(MIT AND ISC) OR Apache-2.0')).toEqual({
      type: 'OR',
      children: [
        {
          type: 'AND',
          children: [
            { type: 'ATOM', id: 'MIT' },
            { type: 'ATOM', id: 'ISC' },
          ],
        },
        { type: 'ATOM', id: 'Apache-2.0' },
      ],
    })
    expect(parseSpdxExpression('GPL-2.0+')).toEqual({ type: 'ATOM', id: 'GPL-2.0+' })
    expect(parseSpdxExpression('GPL-2.0-only WITH Classpath-exception-2.0')).toEqual({
      type: 'ATOM',
      id: 'GPL-2.0-only WITH Classpath-exception-2.0',
    })
    expect(collectSpdxAtoms(parseSpdxExpression('MIT OR ISC OR Apache-2.0'))).toEqual([
      'MIT',
      'ISC',
      'Apache-2.0',
    ])
  })

  it.each([
    '',
    'Proprietary',
    'MIT WITH Made-Up-Exception',
    'LicenseRef-Proprietary',
    'DocumentRef-vendor:LicenseRef-Proprietary',
    'MIT OR LicenseRef-Proprietary',
    '(MIT OR Apache-2.0',
    'MIT OR',
    'MIT Apache-2.0',
  ])('rejects unsupported expression %j', (expression) => {
    expect(() => parseSpdxExpression(expression)).toThrow('Invalid SPDX license expression')
  })

  it('uses selectable OR and conjunctive AND semantics', () => {
    const allowMit = (atomId: string) => atomId === 'MIT'
    expect(evaluateSpdxExpression(parseSpdxExpression('GPL-3.0-only OR MIT'), allowMit)).toBe(true)
    expect(
      evaluateSpdxExpression(parseSpdxExpression('GPL-3.0-only OR AGPL-3.0-only'), allowMit),
    ).toBe(false)
    expect(evaluateSpdxExpression(parseSpdxExpression('MIT AND GPL-3.0-only'), allowMit)).toBe(
      false,
    )
  })

  it('collects every atom for diagnostics', () => {
    expect(collectSpdxAtoms(parseSpdxExpression('(MIT AND ISC) OR GPL-3.0-only'))).toEqual([
      'MIT',
      'ISC',
      'GPL-3.0-only',
    ])
  })
})
