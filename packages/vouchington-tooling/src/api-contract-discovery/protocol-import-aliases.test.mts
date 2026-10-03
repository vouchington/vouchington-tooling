import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'

it('resolves renamed protocol declarations and the imported Readable body adapter', () => {
  const root = mkdtempSync(join(tmpdir(), 'protocol-alias-'))
  try {
    const shared = join(root, 'shared.ts')
    const routes = join(root, 'routes.ts')
    writeFileSync(
      shared,
      `export declare function apiSseFrame<K extends string,T>(key:K,event:T):string
      export type Http<T> = Response & {readonly apiHttpResponseVariants?:T}
      export declare function apiOpenApiHttpResponse<K extends string,T>(key:K,response:Http<T>):Http<T>
      export {apiSseFrame as emitFrame, apiOpenApiHttpResponse as markResponse}`,
    )
    writeFileSync(
      routes,
      `import {emitFrame as frame,markResponse as annotate,type Http} from './shared'
      import {Readable as NodeReadable} from 'node:stream'
      declare const app:any
      declare const stream:{write(value:string):void}
      declare const opaque:Http<{status:200;bodyKind:'content';mediaType:'application/json';body:{result:string}}|{status:202;bodyKind:'none'}>
      app.route('/events').get((ctx:any)=>stream.write(frame('GET:/events',{event:'done' as const,data:{}})))
      app.route('/rpc').post(async(ctx:any)=>{
        const response=annotate('POST:/rpc',opaque)
        ctx.setStatus(response.status)
        if(!response.body) {ctx.response.empty()}
        else await ctx.pipeline(NodeReadable.from((response.body! as AsyncIterable<Uint8Array>)))
      })`,
    )
    const program = ts.createProgram([shared, routes], {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      typeRoots: [join(process.cwd(), 'node_modules/@types')],
      types: ['node'],
    })
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    ).toEqual([])
    const contracts = discoverApiResponseContracts(program, [program.getSourceFile(routes)!])
    expect(
      Object.values(contracts)
        .filter((contract) => contract.method === 'POST')
        .map((contract) => contract.statusCodes),
    ).toEqual([[200], [202]])
    expect(
      Object.values(contracts).find((contract) => contract.method === 'GET')?.sseEvents?.[0]
        ?.eventName,
    ).toBe('done')
    expect(Object.values(contracts).some((contract) => contract.unavailableReason)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
