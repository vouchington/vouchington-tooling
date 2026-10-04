import { beforeAll, describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiQueryContracts } from './query-contract-registry.mts'
import { hasBindingWrite } from './registered-route-binding-writes.mts'
import { visit } from './response-contract-route-analysis.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const route = (body: string) => `
declare const app:any,sink:any,items:any[];
declare function apiQuery(key:string,carrier:unknown):void;
const carrier={queryContract:{post_type:{kind:'string'}}} as const;
app.route('/rpc').get(async(ctx:any)=>{
  apiQuery('GET:/rpc',carrier);
  const query:any={};const options={postType:'post'};
  ${body}
});`
const reads = {
  automod: "query[ctx.query.post_type===undefined?'content_type':'post_type']=options.postType;",
  compound: 'query[ctx.query.post_type]+=options.postType;',
  prefix: '++query[ctx.query.post_type];',
  postfix: 'query[ctx.query.post_type]++;',
  decrement: '--query[ctx.query.post_type];',
  'unary-read': '!ctx.query.post_type;',
  'for-of': 'for(query[ctx.query.post_type] of items){}',
  'for-in': 'for(query[ctx.query.post_type] in query){}',
  nested: 'query[ctx.query.post_type].value=options.postType;',
  destructure: '({[ctx.query.post_type]:query.value}=query);',
  'loop-pattern': 'for(const {[ctx.query.post_type]:value} of items){}',
  unrelated: 'query.value=options.postType;',
} as const
const writes = {
  binding: 'ctx=sink;',
  member: 'ctx.query.post_type=options.postType;',
  method: 'ctx.pipeline=()=>{};',
  'computed-member': "ctx['pipeline']=()=>{};",
  'key-side-effect': 'query[(ctx=sink).query.post_type]=options.postType;',
  'key-member-side-effect': 'query[ctx.query.post_type++]=options.postType;',
  'loop-key-side-effect': 'for(query[(ctx=sink).query.post_type] of items){}',
  'pattern-key-side-effect': '({[(ctx=sink).query.post_type]:query.value}=query);',
  'destructured-binding': '({value:ctx}=query);',
  'loop-binding': 'for(ctx of items){}',
} as const
let matrix: VirtualProgramMatrix<string>
function discover(name: string) {
  return discoverApiQueryContracts(matrix.program, [matrix.sourceFile(name)], new Set(['GET:/rpc']))
}
describe('registered handler binding writes exclude computed property reads', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, {
      ...Object.fromEntries(
        Object.entries({ ...reads, ...writes }).map(([name, body]) => [name, route(body)]),
      ),
      'destructured-parameter': `declare const app:any;
      app.route('/rpc').get(({ctx}:{ctx:any})=>ctx);`,
      'anonymous-declaration': 'export default function(){return 1}',
    })
  })
  it.each(Object.keys(reads))('extracts the query contract after %s', (name) => {
    expect(discover(name)['GET:/rpc']?.parameters.post_type).toEqual({
      kind: 'string',
    })
  })
  it.each(Object.keys(writes))('rejects actual context writes in %s', (name) => {
    expect(() => discover(name)).toThrow('apiQuery must be inside an app.route handler')
  })
  it('keeps destructured parameters unsupported', () => {
    let parameter: ts.ParameterDeclaration | undefined
    visit(matrix.sourceFile('destructured-parameter'), (node) => {
      if (ts.isParameter(node)) parameter = node
    })
    expect(hasBindingWrite(parameter!, matrix.program.getTypeChecker())).toBe(true)
  })
  it('does not invent a binding for anonymous default functions', () => {
    const fn = matrix.sourceFile('anonymous-declaration').statements.find(ts.isFunctionDeclaration)!
    expect(hasBindingWrite(fn, matrix.program.getTypeChecker())).toBe(false)
  })
})
