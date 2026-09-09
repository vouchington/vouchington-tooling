import { describe, expect, it } from 'vitest'

import type { ContractSchemaNode } from '../openapi-document/contract-schema-types.mts'
import { distinctNodes } from './contract-schema-type-utils.mts'

describe('contract schema type utilities', () => {
  it('canonically deduplicates and sorts nested union and intersection nodes', () => {
    const unionWithWarmedCheckerOrder: ContractSchemaNode = {
      type: 'union',
      variants: distinctNodes([
        { type: 'literal', value: 'owner' },
        {
          type: 'intersection',
          variants: distinctNodes([{ type: 'string' }, { type: 'number' }]),
        },
      ]),
    }
    const unionWithColdCheckerOrder: ContractSchemaNode = {
      type: 'union',
      variants: distinctNodes([
        {
          type: 'intersection',
          variants: distinctNodes([{ type: 'number' }, { type: 'string' }]),
        },
        { type: 'literal', value: 'owner' },
      ]),
    }

    expect(
      distinctNodes([
        unionWithWarmedCheckerOrder,
        { type: 'literal', value: 'owner' },
        unionWithColdCheckerOrder,
        { type: 'literal', value: 'moderator' },
      ]),
    ).toEqual([
      { type: 'literal', value: 'moderator' },
      { type: 'literal', value: 'owner' },
      {
        type: 'union',
        variants: [
          {
            type: 'intersection',
            variants: [{ type: 'number' }, { type: 'string' }],
          },
          { type: 'literal', value: 'owner' },
        ],
      },
    ])
  })
})
