import { expect, it } from 'vitest'
import { buildVirtualProgramMatrix } from './test-setup.test-helpers.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'

it('rejects an exported authenticated constructor', () => {
  const matrix = buildVirtualProgramMatrix(import.meta, {
    exported: `
    declare const app:any;declare function apiNoContent<K extends string>(key:K):void;
    interface Ctx{setStatus(value:number):void;response:{empty(value?:void):void}}
    const ws=new WeakSet<Ctx>();const Constructor=WeakSet;export {Constructor};
    app.route('/exported').get((ctx:Ctx)=>{ws.has(ctx);ctx.setStatus(204);ctx.response.empty(apiNoContent('GET:/exported'))});
  `,
  })
  const rows = discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile('exported')],
    undefined,
    { onRouteError: () => {} },
  )
  expect(rows['GET:/exported']?.unavailableReason).toBeDefined()
})
