import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  declare const stream:{write(frame:string):void};
  declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;`
const sources = {
  union: `${preamble}app.route('/events').get((ctx:any)=>{
    const event:{event:'done';data:{}}|{event:'progress';data:{count:number}}=ctx.query.done
      ?{event:'done',data:{}}:{event:'progress',data:{count:1}};
    stream.write(apiSseFrame('GET:/events',event))
  })`,
  factory: `${preamble}
    function factory<T>(options:{value:T;emit:(stream:{write(frame:string):void},
      event:{event:'snapshot';data:T}|{event:'error';data:{message:string}})=>void}):(ctx:any)=>void {
      return ctx=>options.emit(stream,{event:'snapshot',data:options.value})
    }
    app.route('/events').get(factory({value:{count:1},
      emit:(stream,event)=>stream.write(apiSseFrame('GET:/events',event))
    }))`,
  timer: `${preamble}
    function pipe(options:{emit:()=>void}) {
      const {emit}=options;
      return new Promise<void>(resolve=>{function flush(){emit()}setInterval(flush,2000)})
    }
    app.route('/events').get((ctx:any)=>pipe({
      emit:()=>stream.write(apiSseFrame('GET:/events',{event:'progress',data:{ok:true}}))
    }))`,
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})

it.each(['union', 'factory', 'timer'] as const)(
  'fails closed when %s lacks executable stream or encoder provenance',
  (name) => {
    const contracts = discoverApiResponseContracts(
      matrix.program,
      [matrix.sourceFile(name)],
      undefined,
      { onRouteError: () => {} },
    )
    expect(contracts['GET:/events']?.unavailableReason).toBe('SSE route writes an unmarked frame')
    expect(() => discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)])).toThrow(
      'SSE route writes an unmarked frame',
    )
  },
)
