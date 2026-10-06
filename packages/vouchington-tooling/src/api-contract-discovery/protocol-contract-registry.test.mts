import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildOpenApiDocument, type OpenApiResponse } from '../openapi-document/index.mts'
import { validateResponseContract } from '../contract-schema/index.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import ts from '../contract-schema/typescript-api.mts'
import { associateHttpResponse } from './protocol-http-association.mts'
import { visit } from './response-contract-route-analysis.mts'
import { type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
const preamble = `declare const app: any\n  function subscribe(options:{emit:()=>void}):void {options.emit()}\n  declare const stream: { write(frame: string): void }\n  declare function apiSseFrame<K extends string, T>(key: K, event: T): string\n  type Http<T> = Response & { readonly apiHttpResponseVariants?: T }\n  declare function apiOpenApiHttpResponse<K extends string, T>(key: K, response: Http<T>): Http<T>\n  type Variants = {status:200; bodyKind:'content'; mediaType:'application/json'; body:{id:string}|{id:null;error:{code:number}}|{id:string}[]}\n    | {status:202; bodyKind:'none'} | {status:400; bodyKind:'content';mediaType:'application/json';body:{id:null;error:{code:number}}}\n  declare const opaque: Http<Variants>;\n  declare const unknownBody: unknown;`
const sse = (body: string) => `${preamble}\n  app.route('/events').get((ctx:any) => { ${body} })`
const http = (body: string, declarations = '') =>
  `${preamble}\n  ${declarations}\n  app.route('/rpc').post(async (ctx:any) => {\n    const response = apiOpenApiHttpResponse('POST:/rpc', opaque)\n    ctx.setStatus(response.status)\n    ${body}\n  })`
const emit = `if (!response.body) ctx.response.empty(); else ctx.pipeline(response.body)`
const typedHttp = (type: string) =>
  `${preamble}\n  declare const special:Http<${type}>\n  app.route('/rpc').post((ctx:any)=>{const response=apiOpenApiHttpResponse('POST:/rpc',special);\n    ctx.setStatus(response.status); ${emit} })`
const sources = {
  sse: sse(`stream.write(apiSseFrame('GET:/events',{event:'progress' as const,data:{count:1}}))
    stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))`),
  union:
    sse(`const event: {event:'done';data:{}} | {event:'progress';data:{count:number}} = ctx.query.done
    ? {event:'done',data:{}} : {event:'progress',data:{count:1}}
    stream.write(apiSseFrame('GET:/events',event))`).replace(
      /declare (function apiSseFrame[^\n]+)/,
      "$1 {return 'data: {}\\n\\n'}",
    ),
  factory: `${preamble}
    function factory<T>(options:{value:T;emit:(stream:{write(frame:string):void},event:{event:'snapshot';data:T}|{event:'error';data:{message:string}})=>void}):(ctx:any)=>void {return ctx=>options.emit(stream,{event:'snapshot',data:options.value})}
    app.route('/events').get(factory({value:{count:1},emit:(stream,event)=>stream.write(apiSseFrame('GET:/events',event))}))`.replace(
    /declare (function apiSseFrame[^\n]+)/,
    "$1 {return 'data: {}\\n\\n'}",
  ),
  nested: sse(
    `class NestedStream {write(_frame:string):void {}}
      const stream=new NestedStream();
      stream.write(apiSseFrame('GET:/events',{event:'status' as const,data:{result:unknownBody}}))`,
  ).replace(/declare (function apiSseFrame[^\n]+)/, "$1 {return 'data: {}\\n\\n'}"),
  'broad-name': sse(
    `stream.write(apiSseFrame('GET:/events',{event:'progress' as string,data:{count:1}}))`,
  ),
  'unknown-root': sse(
    `stream.write(apiSseFrame('GET:/events',{event:'progress' as const,data:unknownBody}))`,
  ),
  'any-root': sse(
    `stream.write(apiSseFrame('GET:/events',{event:'progress' as const,data:unknownBody as any}))`,
  ),
  raw: sse(
    `stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));stream.write('untyped')`,
  ),
  unused: sse(`apiSseFrame('GET:/events',{event:'done' as const,data:{}})`),
  mismatch: sse(`stream.write(apiSseFrame('POST:/events',{event:'done' as const,data:{}}))`),
  'dynamic-key': sse(
    `stream.write(apiSseFrame('GET:/events' as string,{event:'done' as const,data:{}}))`,
  ),
  outside: `${preamble} stream.write(apiSseFrame('GET:/events',{event:'done',data:{}}))`,
  http: http(emit),
  buffered: http(
    `if (!response.body) ctx.response.empty(); else ctx.response.buffer(await response.arrayBuffer())`,
  ),
  'unknown-raw': http(`${emit}; ctx.pipeline(unknownBody)`),
  'unused-http': http(''),
  'wrong-empty': http(`if (!opaque.body) ctx.response.empty(); else ctx.pipeline(response.body)`),
  'http-missing-carrier': `${preamble} app.route('/rpc').post((ctx:any)=> {
    const response=apiOpenApiHttpResponse('POST:/rpc',new Response())
    ctx.setStatus(response.status);ctx.pipeline(response.body)
  })`,
  'http-broad-status': `${preamble} declare const broad:Http<{status:number;bodyKind:'none'}>\n    app.route('/rpc').post((ctx:any)=>{const response=apiOpenApiHttpResponse('POST:/rpc',broad);\n      ctx.setStatus(response.status);if(!response.body)ctx.response.empty()})`,
  'empty-carrier': typedHttp('undefined'),
  'unknown-carrier': typedHttp('unknown'),
  'invalid-status-low': typedHttp("{status:99;bodyKind:'none'}"),
  'invalid-status-high': typedHttp("{status:600;bodyKind:'none'}"),
  'invalid-status-fraction': typedHttp("{status:200.5;bodyKind:'none'}"),
  'invalid-kind': typedHttp("{status:200;bodyKind:'invalid'}"),
  'ambiguous-kind': typedHttp("{status:200;bodyKind:'content'|'none'}"),
  'broad-media': typedHttp("{status:200;bodyKind:'content';mediaType:string;body:{ok:boolean}}"),
  'missing-event': sse("stream.write(apiSseFrame('GET:/events',{data:{}}))"),
  'missing-data': sse("stream.write(apiSseFrame('GET:/events',{event:'done' as const}))"),
  'empty-name': sse("stream.write(apiSseFrame('GET:/events',{event:'' as const,data:{}}))"),
  'newline-name': sse(
    "stream.write(apiSseFrame('GET:/events',{event:'bad\\nname' as const,data:{}}))",
  ),
  'missing-body': sse("stream.write(apiSseFrame('GET:/events'))").replace('event: T', 'event?: T'),
  'unbound-http': `${preamble} app.route('/rpc').post((ctx:any)=>apiOpenApiHttpResponse('POST:/rpc',opaque))`,
  'mutable-http': http(emit).replace('const response', 'let response'),
  'missing-pipeline': http('if (!response.body) ctx.response.empty(); else ctx.pipeline()'),
  'other-adapter': http(
    'if (!response.body) ctx.response.empty(); else ctx.pipeline(adapter.from(response.body))',
    'declare const adapter:{from(body:unknown):unknown}',
  ),
  'extra-adapter-argument': http(
    'if (!response.body) ctx.response.empty(); else ctx.pipeline(adapter.from(response.body,unknownBody))',
    'declare const adapter:{from(body:unknown,other:unknown):unknown}',
  ),
  'plain-adapter': http(
    'if (!response.body) ctx.response.empty(); else ctx.pipeline(adapter(response.body))',
    'declare function adapter(body:unknown):unknown',
  ),
  'sse-created': sse(
    "ctx.setStatus(201); stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))",
  ),
  'sse-dynamic-status': sse(
    "ctx.setStatus(ctx.query.status); stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))",
  ),
  'registration-evaluation': `${preamble}
    declare function factory(value:unknown):(ctx:any)=>void
    app.route('/events').get(factory(stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))))`,
  'uncalled-http-closure': http(`function neverCalled() {${emit}}`),
  'shadowed-http-context': http(`function neverCalled(ctx:any) {${emit}}`),
  'http-dynamic-status': http(`${emit}; ctx.setStatus(ctx.query.status)`),
  'no-http-context': http(emit)
    .replace('(ctx:any)', '()')
    .replace('app.route', 'declare const ctx:any; app.route'),
  'false-while-http': http(`while(false) {${emit}}`),
  'false-for-http': http(`for(;false;) {${emit}}`),
  'break-http': http(`while(ctx.query.flag) {break; ${emit}}`),
  'continue-http': http(`while(ctx.query.flag) {continue; ${emit}}`),
  'once-do-http': http(`do {${emit}} while(false)`),
  'unbounded-for-http': http(`for(;;) {${emit}; break}`),
  'dynamic-loop-http': http(`for(;ctx.query.flag;) {${emit}; break}`),
  'false-and-http': http(`false && ctx.response.empty(); ctx.pipeline(response.body)`),
  'true-or-http': http(
    `true || ctx.pipeline(response.body); if(!response.body) ctx.response.empty()`,
  ),
  'false-ternary-http': http(
    `false ? ctx.pipeline(response.body) : undefined; if(!response.body)ctx.response.empty()`,
  ),
  'true-ternary-http': http(
    `true ? undefined : ctx.pipeline(response.body); if(!response.body)ctx.response.empty()`,
  ),
  'false-and-sse': sse(
    "false && stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))",
  ),
  'dynamic-ternary-http': http(
    `ctx.query.flag ? ctx.pipeline(response.body) : undefined; if(!response.body) ctx.response.empty()`,
  ),
  'dynamic-logical-http': http(
    `ctx.query.flag && ctx.pipeline(response.body); if(!response.body) ctx.response.empty()`,
  ),
  'parameter-sse': sse(
    "stream.write(apiSseFrame('GET:/events/:id',{event:'done' as const,data:{}}));stream.write(apiSseFrame('GET:/events/:id',{event:'progress' as const,data:{count:1}}))",
  ).replace("route('/events')", "route('/events/:id')"),
  'dead-else-http': http(`if(true) {} else {${emit}}`),
  'terminal-block-http': http(`{return}; ${emit}`),
  'terminal-branches-http': http(`if(ctx.query.flag) return; else throw new Error(); ${emit}`),
  'one-branch-http': http(`if(ctx.query.flag) return; ${emit}`),
  'branch-missing-else-http': http(`if(ctx.query.flag) {} ${emit}`),
  'block-read-http': http(`{(ctx as Context).set('X','ok')}; ${emit}`),
  'conditional-sse-status': sse(
    "if(ctx.query.created) ctx.setStatus(201); stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))",
  ),
  'conditional-sse-block-status': sse(
    "if(ctx.query.created) {ctx.setStatus(201)}; stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))",
  ),
  'dead-sse-status': sse(
    "if(false) ctx.setStatus(201); stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))",
  ),
  'separate-http-status-path': `${preamble} app.route('/rpc').post((ctx:any)=>{const response=apiOpenApiHttpResponse('POST:/rpc',opaque); if(!response.body){ctx.setStatus(response.status);ctx.response.empty()}else ctx.pipeline(response.body)})`,
  'per-branch-http-status': `${preamble} app.route('/rpc').post((ctx:any)=>{const response=apiOpenApiHttpResponse('POST:/rpc',opaque); if(!response.body){ctx.setStatus(response.status);ctx.response.empty()}else {ctx.setStatus(response.status);ctx.pipeline(response.body)}})`,
  'partly-broad-sse': sse(
    "stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));stream.write(apiSseFrame('GET:/events',{event:'broad' as string,data:{}}))",
  ),
  'ignored-callback': `${preamble} function ignore(callback:()=>void){};app.route('/events').get((ctx:any)=>ignore(()=>stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))))`,
  'nullable-property-stream': sse(
    "let sse:{stream:typeof stream}|null=null; sse={stream}; subscribe({emit:()=>sse!.stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})",
  ),
  'property-stream-raw': sse(
    "const sse={stream}; sse!.stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}})); sse.stream.write('raw')",
  ),
  'same-stream-wrappers': sse(
    "const sse={stream}; const other={stream}; sse!.stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}})); other.stream.write('log')",
  ),
  'computed-stream': sse(
    "({stream})['stream'].write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))",
  ),
  'no-sse-context': sse(
    "stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))",
  ).replace('(ctx:any)', '()'),
  'named-sse': `${preamble} function handler(ctx:any) {stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))}; app.route('/events').get(handler)`,
  'named-sse-created': `${preamble} function handler(context:any) {context.setStatus(201);stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))}; app.route('/events').get(handler)`,
  'generator-sse': `${preamble} function* handler(ctx:any) {stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))}; app.route('/events').get(handler)`,
  'nested-sse-created': sse(
    "ctx.setStatus(201); subscribe({emit:()=>{stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))}})",
  ).replaceAll('ctx', 'context'),
  'uncalled-sse-function': sse(
    "function unused() {stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))}",
  ),
  'uncalled-sse-arrow': sse(
    "const unused=()=>stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))",
  ),
  'dead-sse': sse(
    "if(false) stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))",
  ),
  'unrelated-write': sse(
    "stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}})); const log={write:(value:string)=>value}; log.write('log')",
  ),
  'renamed-sse-created': sse(
    "ctx.setStatus(201); stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))",
  ).replaceAll('ctx', 'context'),
  'renamed-sse-dynamic': sse(
    "ctx.setStatus(ctx.query.status); stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))",
  ).replaceAll('ctx', 'context'),
  'dead-http': http(`if(false) {${emit}}`),
  'unreachable-http': http(`return; ${emit}`),
  'renamed-http-raw': http(`${emit}; ctx.pipeline(unknownBody)`).replaceAll('ctx', 'context'),
  'local-readable': http(
    'if(!response.body)ctx.response.empty(); else ctx.pipeline(Readable.from(response.body))',
    'declare const Readable:{from(body:unknown):unknown}',
  ),
  'renamed-http-context': http(emit).replaceAll('ctx', 'context'),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
let fixtureRoot: string
afterAll(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
})
function discover(name: keyof typeof sources, lenient = false) {
  return discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    undefined,
    lenient ? { onRouteError: () => {} } : undefined,
  )
}
describe('compiler-discovered protocol contracts', () => {
  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'protocol-platform-provenance-'))
    const dependency = join(fixtureRoot, 'node_modules/@jongleberry/api-server')
    mkdirSync(dependency, { recursive: true })
    writeFileSync(
      join(dependency, 'package.json'),
      '{"name":"@jongleberry/api-server","version":"0.0.0","type":"module","types":"./index.d.mts"}',
    )
    writeFileSync(
      join(dependency, 'index.d.mts'),
      'export declare class Context {set(header:string,value:string):void}',
    )
    const files = new Map(
      Object.entries(sources).map(([name, source]) => {
        const file = join(fixtureRoot, `${name}.ts`)
        writeFileSync(
          file,
          "import type {Context} from '@jongleberry/api-server';\n" + source + '\nexport {}',
        )
        return [name, file]
      }),
    )
    const program = ts.createProgram([...files.values()], {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ESNext,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    })
    expect(ts.getPreEmitDiagnostics(program).map((value) => value.code)).toEqual([])
    matrix = {
      program,
      sourceFile: (name) => program.getSourceFile(files.get(name)!)!,
    }
  })
  it.each([
    'sse',
    'union',
    'factory',
    'nested',
    'unrelated-write',
    'named-sse',
    'no-sse-context',
    'nullable-property-stream',
    'dead-sse-status',
  ] as const)('extracts actual named payloads from %s', (name) => {
    const contracts = discover(name)
    const events = Object.values(contracts).flatMap((contract) => contract.sseEvents ?? [])
    expect(events.length).toBeGreaterThan(0)
    expect(
      Object.values(contracts).every((contract) => contract.mediaType === 'text/event-stream'),
    ).toBe(true)
    const document = buildOpenApiDocument({
      title: 'Protocol fixture',
      responseContracts: contracts,
    })
    expect(document['x-unavailable-routes']).toEqual([])
    const media = (document.paths['/events']!.get!.responses[200] as OpenApiResponse).content![
      'text/event-stream'
    ]!
    expect(media.schema).toEqual({ type: 'string' })
    expect(Object.keys(media['x-sse-events']!)).toEqual(
      expect.arrayContaining(events.map((event) => event.eventName)),
    )
  })
  it.each(
    [
      [],
      ['GET:/unrelated'],
      ['GET:/events'],
      ['GET:/events#protocol-2'],
      ['GET:/events', 'GET:/events#protocol-2'],
    ].map((keys) => ({ keys })),
  )('restricts protocol contracts to requested SSE keys $keys', ({ keys }) => {
    const contracts = discoverApiResponseContracts(
      matrix.program,
      [matrix.sourceFile('sse')],
      new Set(keys),
    )
    expect(Object.keys(contracts)).toEqual(keys.filter((key) => key !== 'GET:/unrelated'))
  })
  it('does not validate excluded protocol routes', () => {
    for (const name of ['broad-name', 'dynamic-key', 'http-broad-status'] as const) {
      const contracts = discoverApiResponseContracts(
        matrix.program,
        [matrix.sourceFile(name)],
        new Set(['GET:/unrelated']),
      )
      expect(contracts).toEqual({})
    }
  })
  it('restricts branded HTTP variants to their exact requested key', () => {
    const contracts = discoverApiResponseContracts(
      matrix.program,
      [matrix.sourceFile('http')],
      new Set(['POST:/rpc#protocol-2']),
    )
    expect(Object.keys(contracts)).toEqual(['POST:/rpc#protocol-2'])
    expect(contracts['POST:/rpc#protocol-2']!.statusCodes).toEqual([202])
  })
  it.each(['GET:/events/:eventId', 'GET:/events/:eventId#protocol-2'])(
    'maps normalized requested protocol key %s',
    (key) => {
      const contracts = discoverApiResponseContracts(
        matrix.program,
        [matrix.sourceFile('parameter-sse')],
        new Set([key]),
      )
      expect(Object.keys(contracts)).toEqual([key])
    },
  )
  it('validates only the requested generated protocol variants', () => {
    expect(
      Object.keys(
        discoverApiResponseContracts(
          matrix.program,
          [matrix.sourceFile('partly-broad-sse')],
          new Set(['GET:/events']),
        ),
      ),
    ).toEqual(['GET:/events'])
    expect(() =>
      discoverApiResponseContracts(
        matrix.program,
        [matrix.sourceFile('partly-broad-sse')],
        new Set(['GET:/events#protocol-2']),
      ),
    ).toThrow()
    expect(() => discover('partly-broad-sse')).toThrow()
  })
  it('validates the actual data shape rather than the framed string', () => {
    const events = Object.values(discover('sse')).flatMap((contract) => contract.sseEvents ?? [])
    const progress = events.find((event) => event.eventName === 'progress')!.contract
    expect(validateResponseContract(progress.schema, { count: 2 })).toEqual([])
    expect(validateResponseContract(progress.schema, 'data: {}')).not.toEqual([])
  })
  it.each(['broad-name', 'unknown-root', 'any-root', 'raw', 'unused'] as const)(
    'fails closed for %s',
    (name) => {
      expect(() => discover(name)).toThrow()
      const contracts = discover(name, true)
      expect(Object.values(contracts).some((contract) => contract.unavailableReason)).toBe(true)
    },
  )
  it.each(['mismatch', 'dynamic-key', 'outside', 'registration-evaluation'] as const)(
    'rejects misplaced marker %s',
    (name) => {
      expect(() => discover(name)).toThrow(/route|literal contract key/)
    },
  )
  it.each([
    'http',
    'buffered',
    'renamed-http-context',
    'one-branch-http',
    'branch-missing-else-http',
    'block-read-http',
    'dynamic-ternary-http',
    'dynamic-logical-http',
    'once-do-http',
    'unbounded-for-http',
    'dynamic-loop-http',
    'per-branch-http-status',
  ] as const)('extracts JSON200/batch/error, bodyless202 and JSON400 from %s', (name) => {
    const contracts = discover(name)
    expect(Object.values(contracts).map((contract) => contract.statusCodes)).toEqual([
      [200],
      [202],
      [400],
    ])
    expect(
      Object.values(contracts).find((contract) => contract.statusCodes?.[0] === 400)
        ?.includeDefaultError,
    ).toBe(true)
    const response = Object.values(contracts).find((contract) => contract.statusCodes?.[0] === 200)!
    expect(validateResponseContract(response.schema, [{ id: 'batch' }])).toEqual([])
    expect(validateResponseContract(response.schema, { id: null, error: { code: -1 } })).toEqual([])
    const document = buildOpenApiDocument({ title: 'HTTP', responseContracts: contracts })
    expect(document['x-unavailable-routes']).toEqual([])
    expect(
      (document.paths['/rpc']!.post!.responses[202] as OpenApiResponse).content,
    ).toBeUndefined()
  })
  it('retains an unrelated raw response as unavailable', () => {
    const contracts = discover('unknown-raw', true)
    expect(Object.values(contracts).some((contract) => contract.unavailableReason)).toBe(true)
    expect(
      buildOpenApiDocument({ title: 'Raw', responseContracts: contracts })['x-unavailable-routes'],
    ).toEqual(['POST:/rpc'])
  })
  it.each([
    'unused-http',
    'wrong-empty',
    'http-missing-carrier',
    'http-broad-status',
    'empty-carrier',
    'unknown-carrier',
    'invalid-status-low',
    'invalid-status-high',
    'invalid-status-fraction',
    'invalid-kind',
    'ambiguous-kind',
    'broad-media',
    'missing-event',
    'missing-data',
    'empty-name',
    'newline-name',
    'missing-body',
    'unbound-http',
    'mutable-http',
    'missing-pipeline',
    'other-adapter',
    'extra-adapter-argument',
    'plain-adapter',
    'sse-dynamic-status',
    'uncalled-http-closure',
    'shadowed-http-context',
    'http-dynamic-status',
    'no-http-context',
    'uncalled-sse-function',
    'uncalled-sse-arrow',
    'dead-sse',
    'renamed-sse-dynamic',
    'dead-http',
    'unreachable-http',
    'renamed-http-raw',
    'local-readable',
    'computed-stream',
    'property-stream-raw',
    'same-stream-wrappers',
    'conditional-sse-status',
    'conditional-sse-block-status',
    'separate-http-status-path',
    'ignored-callback',
    'dead-else-http',
    'terminal-block-http',
    'terminal-branches-http',
    'false-while-http',
    'false-for-http',
    'break-http',
    'continue-http',
    'false-and-http',
    'true-or-http',
    'false-ternary-http',
    'true-ternary-http',
    'false-and-sse',
    'generator-sse',
  ] as const)('rejects unsound HTTP metadata or emissions %s', (name) => {
    expect(() => discover(name)).toThrow()
    expect(Object.values(discover(name, true)).some((contract) => contract.unavailableReason)).toBe(
      true,
    )
  })
  it.each([
    'sse-created',
    'renamed-sse-created',
    'nested-sse-created',
    'named-sse-created',
  ] as const)('documents a literal SSE status for %s', (name) => {
    const contracts = discover(name)
    expect(Object.values(contracts)[0]?.statusCodes).toEqual([201])
    const document = buildOpenApiDocument({ title: 'SSE created', responseContracts: contracts })
    expect(document.paths['/events']!.get!.responses[201]).toBeDefined()
    expect(document.paths['/events']!.get!.responses[200]).toBeUndefined()
  })
  it('requires an executable handler context for opaque HTTP association', () => {
    const file = matrix.sourceFile('outside')
    const checker = matrix.program.getTypeChecker()
    let call: ts.CallExpression | undefined
    visit(file, (node) => {
      if (ts.isCallExpression(node)) call = node
    })
    const symbol = checker.getSymbolAtLocation(call!.expression)!
    expect(() => associateHttpResponse(call!, symbol, checker)).toThrow(
      'HTTP response must bind the handler context',
    )
  })
})
