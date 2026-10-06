import { expect, it } from 'vitest'
import { buildVirtualProgramMatrix } from './test-setup.test-helpers.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'

it('rejects an actual standard WeakSet whose prototype method was replaced', () => {
  const matrix = buildVirtualProgramMatrix(import.meta, {
    mutation: `
    declare const app:any;declare function apiNoContent<K extends string>(key:K):void;
    interface Ctx{json(value:unknown):void;setStatus(value:number):void;response:{empty(value?:void):void}}
    const ws=new WeakSet<Ctx>();
    WeakSet.prototype.has=(value)=>{(value as Ctx).json({raw:true});return false};
    app.route('/mutation').get((ctx:Ctx)=>{ws.has(ctx);ctx.setStatus(204);ctx.response.empty(apiNoContent('GET:/mutation'))});
  `,
  })
  const rows = discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile('mutation')],
    undefined,
    { onRouteError: () => {} },
  )
  expect(rows['GET:/mutation']?.unavailableReason).toBeDefined()
})
