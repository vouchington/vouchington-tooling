import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
const route = (body: string) => `declare const app:any;
 declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
 class Stream{write(_value:string):void{}ignore():void{}}
 const stream=new Stream();const other=new Stream();
 app.route('/events').get(()=>{${body};stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})`
const sources = {
  mutable: route('let selected=stream;(selected as Stream&{raw():void}).raw()'),
  element: route("let selected=stream;(selected as Stream&{raw():void})['raw']()"),
  chained: route('let selected=stream;const alias=selected;(alias as Stream&{raw():void}).raw()'),
  independent: route('(other as Stream&{raw():void}).raw()'),
  ignored: route('let selected=stream;selected.ignore()'),
  dead: route('let selected=stream;if(false)(selected as Stream&{raw():void}).raw()'),
  unused: route('let selected=stream'),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
const row = (name: keyof typeof sources) =>
  discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], undefined, {
    onRouteError: () => {},
  })['GET:/events']
it.each(['mutable', 'element', 'chained'] as const)(
  'rejects indeterminate actual selected receiver %s',
  (name) => expect(row(name)?.unavailableReason).toBe('SSE route writes an unmarked frame'),
)
it.each(['independent', 'ignored', 'dead', 'unused'] as const)(
  'preserves accounted or unused receiver %s',
  (name) => expect(row(name)?.unavailableReason).toBeUndefined(),
)
