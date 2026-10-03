import { beforeAll, describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from '../openapi-document/index.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  type Http<T>=Response & {readonly apiHttpResponseVariants?:T};
  type Variant={status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}};
  declare const good:Http<Variant>;
  declare const missing:Response;
  declare const noVariants:Http<undefined>;
  declare function apiOpenApiHttpResponse<T>(key:string,response:T):T;`
const valid = (name: string) => `const ${name}=apiOpenApiHttpResponse('POST:/rpc',good);
  ctx.setStatus(${name}.status);ctx.pipeline(${name}.body);`
const route = (body: string) => `${preamble}app.route('/rpc').post((ctx:any)=>{${body}})`
const invalid = {
  unbound: `apiOpenApiHttpResponse('POST:/rpc',good);`,
  'missing-carrier': `const invalid=apiOpenApiHttpResponse('POST:/rpc',missing);`,
  'empty-carrier': `const invalid=apiOpenApiHttpResponse('POST:/rpc',noVariants);`,
} as const
const sources = {
  'unbound-before': route(`${invalid.unbound}${valid('response')}`),
  'unbound-after': route(`${valid('response')}${invalid.unbound}`),
  'missing-before': route(`${invalid['missing-carrier']}${valid('response')}`),
  'missing-after': route(`${valid('response')}${invalid['missing-carrier']}`),
  'empty-before': route(`${invalid['empty-carrier']}${valid('response')}`),
  'empty-after': route(`${valid('response')}${invalid['empty-carrier']}`),
  'valid-same-key': route(`${valid('first')}${valid('second')}`),
  'two-failures': route(`${invalid.unbound}${invalid['missing-carrier']}${valid('response')}`),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
function discover(name: keyof typeof sources, errors?: unknown[], keys?: readonly string[]) {
  return discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    keys && new Set(keys),
    errors ? { onRouteError: (error) => errors.push(error) } : undefined,
  )
}

describe('protocol failure key reservation', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each([
    'unbound-before',
    'unbound-after',
    'missing-before',
    'missing-after',
    'empty-before',
    'empty-after',
  ] as const)('retains the extraction failure for %s alongside a same-key valid marker', (name) => {
    expect(() => discover(name)).toThrow()
    const errors: unknown[] = []
    const rows = discover(name, errors)
    expect(errors).toHaveLength(1)
    expect(Object.keys(rows)).toHaveLength(2)
    expect(Object.values(rows).filter((row) => row.unavailableReason)).toHaveLength(1)
    expect(Object.values(rows).filter((row) => !row.unavailableReason)).toHaveLength(1)
    expect(
      buildOpenApiDocument({ title: 'Reserved failure', responseContracts: rows })[
        'x-unavailable-routes'
      ],
    ).toEqual(['POST:/rpc'])
  })
  it('preserves both malformed markers before the successful marker', () => {
    const errors: unknown[] = []
    const rows = discover('two-failures', errors)
    expect(errors).toHaveLength(2)
    expect(Object.keys(rows).toSorted()).toEqual([
      'POST:/rpc',
      'POST:/rpc#protocol-2',
      'POST:/rpc#protocol-3',
    ])
    expect(Object.values(rows).filter((row) => row.unavailableReason)).toHaveLength(2)
    expect(rows['POST:/rpc#protocol-3']!.unavailableReason).toBeUndefined()
  })
  it('keeps valid same-key markers as distinct available variants', () => {
    const rows = discover('valid-same-key')
    expect(Object.keys(rows)).toEqual(['POST:/rpc', 'POST:/rpc#protocol-2'])
    expect(Object.values(rows).every((row) => !row.unavailableReason)).toBe(true)
    expect(
      buildOpenApiDocument({ title: 'Valid variants', responseContracts: rows })[
        'x-unavailable-routes'
      ],
    ).toEqual([])
  })
  it.each(['POST:/rpc', 'POST:/rpc#protocol-2'])(
    'keeps exact requested row %s after a failure reserved the first slot',
    (key) => {
      const rows = discover('missing-before', [], [key])
      expect(Object.keys(rows)).toEqual([key])
      expect(Boolean(rows[key]!.unavailableReason)).toBe(key === 'POST:/rpc')
    },
  )
})
