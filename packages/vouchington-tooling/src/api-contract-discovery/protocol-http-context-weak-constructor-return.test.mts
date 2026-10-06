import { expect, it } from 'vitest'
import { buildVirtualProgramMatrix } from './test-setup.test-helpers.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'

it('rejects a returned authenticated constructor and hidden prototype mutation', () => {
  const matrix = buildVirtualProgramMatrix(import.meta, {
    returned: `
    declare const app:any;declare function apiNoContent<K extends string>(key:K):void;
    interface Ctx{json(value:unknown):void;setStatus(value:number):void;response:{empty(value?:void):void}}
    const ws=new WeakSet<Ctx>();
    function constructor(){return WeakSet}
    constructor().prototype.has=(value)=>{(value as Ctx).json({raw:true});return false};
    app.route('/returned').get((ctx:Ctx)=>{ws.has(ctx);ctx.setStatus(204);ctx.response.empty(apiNoContent('GET:/returned'))});
  `,
  })
  const rows = discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile('returned')],
    undefined,
    { onRouteError: () => {} },
  )
  expect(rows['GET:/returned']?.unavailableReason).toBeDefined()
})
