import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { independentArgumentOrigin } from './protocol-sse-independent-origin.mts'
import { factoryCreatesFreshSelectedStream } from './protocol-sse-fresh-factory.mts'
import { opaqueArgumentExcludesSelectedStream } from './protocol-sse-opaque-identity.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  class Stream{write(_value:string):void{}on(_event:string,_callback:(error:Error)=>void):void{}}
  type Owner={stream:Stream;lifecycleSignal:{addEventListener(event:string,callback:()=>void):void}};
  function startSSE():Owner{const stream=new Stream();
    return {stream,lifecycleSignal:{addEventListener(_event:string,_callback:()=>void){}}}}
  function reuseSSE(stream:Stream):{stream:Stream}{return {stream}}
  function identity<T>(value:T):T{return value}
  function replaceableSSE():Owner{const stream=new Stream();
    return {stream,lifecycleSignal:{addEventListener(_event:string,_callback:()=>void){}}}}
  function propertySSE():Owner{return {stream:new Stream(),
    lifecycleSignal:{addEventListener(_event:string,_callback:()=>void){}}}}
  declare const prior:Stream;
  declare const requestRef:{id:string};
  class CachedStream extends Stream{constructor(){super();return prior as CachedStream}}
  function cachedSSE():{stream:Stream}{const stream=new CachedStream();return {stream}}
  function spreadSSE(extra:{stream?:Stream}):{stream:Stream}{
    const stream=new Stream();return {stream,...extra} as {stream:Stream}}
  let MutableStream=class{write(_value:string):void{}}
  function mutableConstructorSSE():{stream:InstanceType<typeof MutableStream>}{
    const stream=new MutableStream();return {stream}}
  declare function opaque(value:unknown):void;
  declare function getStream():Stream;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  `
const fixtureDirectory = dirname(fileURLToPath(import.meta.url))
const nodeTypeRoots = join(fixtureDirectory, '../../../../node_modules/@types')
const frame = (stream: string) =>
  `${stream}.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))`
const route = (body: string) => `${preamble}app.route('/events').get(()=>{${body}})`
const sources = {
  'incremented-owner': route(`
    (Number.prototype as any).stream=prior;let sse:any;opaque(prior);
    sse=startSSE();sse++;${frame('sse.stream')}`),
  'decremented-owner': route(`
    (Number.prototype as any).stream=prior;let sse:any;opaque(prior);
    sse=startSSE();--sse;${frame('sse.stream')}`),
  'incremented-factory': route(`
    (replaceableSSE as any)++;opaque(prior);
    const {stream}=replaceableSSE();${frame('stream')}`),
  'decremented-factory': route(`
    --(replaceableSSE as any);opaque(prior);
    const {stream}=replaceableSSE();${frame('stream')}`),
  'logical-owner-control': route(`
    let sse:Owner|undefined;opaque(prior);sse=startSSE();!sse;${frame('sse.stream')}`),
  'logical-factory-control': route(`
    !replaceableSSE;opaque(prior);const {stream}=replaceableSSE();${frame('stream')}`),
  'mq-control-calls': route(`
    const {stream,lifecycleSignal}=startSSE();
    function onError(_error:Error){}stream.on('error',onError);
    const interval=setInterval(()=>{},2000);clearInterval(interval);
    lifecycleSignal.addEventListener('abort',()=>{});
    ${frame('stream')}`),
  'single-assignment-before-stream': route(`
    let sse:ReturnType<typeof startSSE>|undefined;
    const jobId='job';opaque(jobId);
    try{throw Error('failure')}catch(err){opaque(err)}
    sse=startSSE();${frame('sse!.stream')}`),
  'const-destructure-after-validation': route(`
    const user={id:'user'};opaque(user);
    const requestRef={id:'request'};opaque(requestRef.id);
    const {stream}=startSSE();${frame('stream')}`),
  'property-return-fresh-stream': route(`
    const callback=()=>{};opaque(callback);
    const {stream}=propertySSE();${frame('stream')}`),
  'callback-after-fresh-assignment': route(`
    let sse:Owner|undefined;sse=startSSE();
    const callback=()=>{};opaque(callback);${frame('sse!.stream')}`),
  'selected-direct': route(`const {stream}=startSSE();opaque(stream);${frame('stream')}`),
  'selected-const-alias': route(
    `const {stream}=startSSE();const alias=stream;opaque(alias);${frame('stream')}`,
  ),
  'selected-cast-alias': route(`
    const {stream}=startSSE();
    const alias:{code:string}=stream as unknown as {code:string};
    opaque(alias);${frame('stream')}`),
  'selected-assigned-cast-alias': route(`
    const {stream}=startSSE();
    let alias:{code:string};alias=stream as unknown as {code:string};
    opaque(alias);${frame('stream')}`),
  'selected-destructured-alias': route(`
    const {stream}=startSSE();const {value:alias}={value:stream};
    opaque(alias);${frame('stream')}`),
  'selected-destructured-cast-alias': route(`
    const {stream}=startSSE();
    const {value:alias}={value:stream as unknown as {code:string}};
    opaque(alias);${frame('stream')}`),
  'selected-container-alias': route(`
    const {stream}=startSSE();const container={value:stream};
    opaque(container.value);${frame('stream')}`),
  'same-type-opaque-unknown': route(`
    const {stream}=startSSE();const unknownStream=getStream();
    opaque(unknownStream);${frame('stream')}`),
  'callback-after-assignment': route(`
    let sse:ReturnType<typeof startSSE>|undefined;
    const later=()=>opaque(sse!.stream);
    sse=startSSE();later();${frame('sse!.stream')}`),
  'borrowed-destructure-after-call': route(`
    const before=getStream();opaque(before);
    const {stream}=reuseSSE(before);${frame('stream')}`),
  'borrowed-assignment-after-call': route(`
    const before=getStream();let sse:ReturnType<typeof reuseSSE>|undefined;
    opaque(before);sse=reuseSSE(before);${frame('sse!.stream')}`),
  'custom-constructor-after-call': route(`
    const before:unknown=prior;opaque(before);
    const {stream}=cachedSSE();${frame('stream')}`),
  'reassigned-destructure-after-call': route(`
    const before:unknown=getStream();opaque(before);
    let {stream}=startSSE();stream=before as Stream;${frame('stream')}`),
  'spread-overrides-fresh-stream': route(`
    const before=getStream();opaque(before);
    const {stream}=spreadSSE({stream:before});${frame('stream')}`),
  'reassigned-constructor-before-call': route(`
    const before:unknown=prior;
    MutableStream=class{write(_value:string):void{}constructor(){return before as any}};
    opaque(before);const {stream}=mutableConstructorSSE();${frame('stream')}`),
  'helper-return-cast-alias': route(`
    const {stream}=startSSE();
    const hidden:{code:string}=identity(stream as unknown as {code:string});
    opaque(hidden);${frame('stream')}`),
  'object-container-cast-alias': route(`
    const {stream}=startSSE();
    const bag={name:'',message:'',hidden:stream} as Error;
    opaque(bag);${frame('stream')}`),
  'reassigned-factory-before-call': route(`
    const before:unknown=prior;
    (replaceableSSE as any)=()=>({stream:before});
    opaque(before);const {stream}=replaceableSSE();${frame('stream')}`),
  'assignment-inside-loop': route(`
    let sse:Owner|undefined;const before:unknown=prior;opaque(before);
    for(const _ of [1])sse=startSSE();${frame('sse!.stream')}`),
  'selected-property-reassigned': route(`
    let sse:Owner|undefined;const before:unknown=prior;opaque(before);
    sse=startSSE();sse.stream=before as Stream;${frame('sse.stream')}`),
  'selected-owner-for-of-write': route(`
    let sse:Owner|undefined;const before:unknown=prior;opaque(before);
    for(sse of [startSSE()]){}${frame('sse!.stream')}`),
  'conditional-selected-alias': route(`
    const {stream}=startSSE();
    const hidden=Math.random()>0.5?stream:getStream();
    opaque(hidden);${frame('stream')}`),
  'function-declaration-control': route(`
    const {stream}=startSSE();function onError(_error:Error){};
    opaque(onError);${frame('stream')}`),
  'function-expression-control': route(`
    const {stream}=startSSE();const onError=function(_error:Error){};
    opaque(onError);${frame('stream')}`),
  'return-nonobject-factory': route(`
    function possible():Owner{return prior as unknown as Owner}
    const before:unknown=prior;opaque(before);
    const {stream}=possible();${frame('stream')}`),
  'computed-return-property': route(`
    function possible():Owner{return {['stream']:prior,lifecycleSignal:startSSE().lifecycleSignal}}
    const before:unknown=prior;opaque(before);
    const {stream}=possible();${frame('stream')}`),
  'factory-call-return-property': route(`
    function possible():Owner{return {stream:getStream(),lifecycleSignal:startSSE().lifecycleSignal}}
    const before:unknown=prior;opaque(before);
    const {stream}=possible();${frame('stream')}`),
  'nested-factory-return': route(`
    function fresh(){function decoy(){return {stream:prior}};
      const stream=new Stream();return {stream}}
    const before:unknown=prior;opaque(before);
    const {stream}=fresh();${frame('stream')}`),
  'bare-factory-return': route(`
    function possible(){if(Math.random()>0.5)return;
      const stream=new Stream();return {stream}}
    const before:unknown=prior;opaque(before);
    const {stream}=possible()!;${frame('stream')}`),
  'factory-member-call': route(`
    const holder={possible:()=>({stream:prior})};
    const before:unknown=prior;opaque(before);
    const {stream}=holder.possible();${frame('stream')}`),
  'constructor-expression': route(`
    function possible(){const stream=new (class extends Stream{})();return {stream}}
    const before:unknown=prior;opaque(before);
    const {stream}=possible();${frame('stream')}`),
  'property-of-independent-object': route(`
    const {stream}=startSSE();opaque(requestRef.id);${frame('stream')}`),
  'local-timer-returning-selected-stream': route(`
    const {stream}=startSSE();
    function setInterval(_callback:()=>void,_delay:number){return stream}
    const interval=setInterval(()=>{},2000);opaque(interval);${frame('stream')}`),
  'callback-returns-selected-stream': route(`
    const {stream}=startSSE();const expose=()=>stream;
    opaque(expose);${frame('stream')}`),
  'function-declaration-returns-stream': route(`
    const {stream}=startSSE();function expose(){return stream}
    opaque(expose);${frame('stream')}`),
  'function-expression-returns-stream': route(`
    const {stream}=startSSE();const expose=function(){return stream};
    opaque(expose);${frame('stream')}`),
  'numeric-control': route(`
    const {stream}=startSSE();const status=200;
    opaque(status);${frame('stream')}`),
  'owner-outside-route-handler': `${preamble}
    let sse:Owner|undefined;
    app.route('/events').get(()=>{const before:unknown=prior;opaque(before);
      sse=startSSE();${frame('sse!.stream')}})`,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
const discover = (name: keyof typeof sources) =>
  discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)])

it('does not treat a property of an independent object as its own allocation', () => {
  const source = matrix.sourceFile('property-of-independent-object')
  let opaqueCall: ts.CallExpression | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'opaque') opaqueCall = node
    node.forEachChild(visit)
  }
  visit(source)
  expect(opaqueCall).toBeDefined()
  const checker = matrix.program.getTypeChecker()
  const receiver = expressionReceiver(opaqueCall!.arguments[0]!, checker)
  expect(receiver?.path).toEqual(['id'])
  expect(independentArgumentOrigin(receiver!, checker)).toBe(false)
})

it.each([
  'logical-owner-control',
  'logical-factory-control',
  'mq-control-calls',
  'single-assignment-before-stream',
  'const-destructure-after-validation',
  'property-return-fresh-stream',
  'callback-after-fresh-assignment',
  'function-declaration-control',
  'function-expression-control',
  'numeric-control',
  'nested-factory-return',
] as const)('keeps marked SSE frames when %s passes unrelated values', (name) => {
  expect(discover(name)['GET:/events']?.unavailableReason).toBeUndefined()
})

it('recognizes a fresh Node PassThrough returned by a local SSE factory', () => {
  const root = mkdtempSync(join(fixtureDirectory, '.sse-node-'))
  try {
    const file = join(root, 'route.ts')
    writeFileSync(
      file,
      `import {PassThrough} from 'node:stream';
      declare const app:any;declare function opaque(value:unknown):void;
      declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
      function fresh(){const stream=new PassThrough();return {stream}}
      app.route('/events').get(()=>{const callback=()=>{};opaque(callback);
        const {stream}=fresh();${frame('stream')}})`,
    )
    const program = ts.createProgram([file], {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
      typeRoots: [nodeTypeRoots],
      types: ['node'],
    })
    expect(ts.getPreEmitDiagnostics(program)).toEqual([])
    expect(
      discoverApiResponseContracts(program, [program.getSourceFile(file)!])['GET:/events']
        ?.unavailableReason,
    ).toBeUndefined()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const inspectUncheckedJs = (
  body: string,
  inspect: (source: ts.SourceFile, checker: ts.TypeChecker) => void,
) => {
  const root = mkdtempSync(join(fixtureDirectory, '.sse-js-'))
  try {
    const file = join(root, 'route.js')
    writeFileSync(
      file,
      `import {borrowed} from './unresolved.js';
       const app={route(){return {get(){}}}};
       class Stream{write(_value){}};
       function startSSE(){const stream=new Stream();return {stream}}
       function opaque(_value){}
       const prior=new Stream();
       app.route('/events').get(()=>{${body}})`,
    )
    const program = ts.createProgram([file], {
      allowJs: true,
      checkJs: false,
      noEmit: true,
      target: ts.ScriptTarget.ESNext,
    })
    inspect(program.getSourceFile(file)!, program.getTypeChecker())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

it.each([
  [
    `function possible(){const stream=new Stream();return {stream,stream:prior}}
    const {stream}=possible();stream.write('')`,
    'possible',
  ],
  [
    `const before=prior;Stream=class{constructor(){return before}write(_value){}};
    const {stream}=startSSE();stream.write('')`,
    'startSSE',
  ],
  [`const {stream}=unknownFactory();stream.write('')`, 'unknownFactory'],
] as const)('rejects an unproven factory in unchecked JS: %s', (body, factoryName) => {
  inspectUncheckedJs(body, (source, checker) => {
    let factoryCall: ts.CallExpression | undefined
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === factoryName)
        factoryCall = node
      node.forEachChild(visit)
    }
    visit(source)
    expect(factoryCall).toBeDefined()
    expect(factoryCreatesFreshSelectedStream(factoryCall!, 'stream', checker)).toBe(false)
  })
})

it('keeps a selected receiver with an unresolved property unknown in unchecked JS', () => {
  inspectUncheckedJs(
    `const callback=()=>{};const sse=startSSE();
    opaque(callback);sse.missing.write('')`,
    (source, checker) => {
      let opaqueCall: ts.CallExpression | undefined
      let writeCall: ts.CallExpression | undefined
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'opaque')
          opaqueCall = node
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'sse.missing.write')
          writeCall = node
        node.forEachChild(visit)
      }
      visit(source)
      expect(opaqueCall).toBeDefined()
      expect(writeCall).toBeDefined()
      const actual = expressionReceiver(opaqueCall!.arguments[0]!, checker)!
      const selected = expressionReceiver(
        (writeCall!.expression as ts.PropertyAccessExpression).expression,
        checker,
      )!
      expect(
        opaqueArgumentExcludesSelectedStream(
          opaqueCall!,
          opaqueCall!.arguments[0]!,
          actual,
          [selected],
          checker,
        ),
      ).toBe(false)
    },
  )
})

it.each([
  [`const {stream}=startSSE();opaque(borrowed);stream.write('')`, 'stream.write', true],
  [`const callback=()=>{};opaque(callback);borrowed.write('')`, 'borrowed.write', false],
] as const)(
  'keeps a receiver with an unresolved imported symbol unknown: %s',
  (body, writeName, missingArgument) => {
    inspectUncheckedJs(body, (source, checker) => {
      let opaqueCall: ts.CallExpression | undefined
      let writeCall: ts.CallExpression | undefined
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'opaque')
          opaqueCall = node
        if (ts.isCallExpression(node) && node.expression.getText(source) === writeName)
          writeCall = node
        node.forEachChild(visit)
      }
      visit(source)
      expect(opaqueCall).toBeDefined()
      expect(writeCall).toBeDefined()
      const actual = expressionReceiver(opaqueCall!.arguments[0]!, checker)!
      const selected = expressionReceiver(
        (writeCall!.expression as ts.PropertyAccessExpression).expression,
        checker,
      )!
      expect((missingArgument ? actual : selected).root.valueDeclaration).toBeUndefined()
      expect(
        opaqueArgumentExcludesSelectedStream(
          opaqueCall!,
          opaqueCall!.arguments[0]!,
          actual,
          [selected],
          checker,
        ),
      ).toBe(false)
    })
  },
)

it.each([
  `globalThis.setInterval=((_callback:unknown)=>stream as any) as typeof setInterval;`,
  `for(globalThis.setInterval of [((_callback:unknown)=>stream as any) as typeof setInterval]){}`,
])('rejects a timer call whose global constructor was replaced: %s', (replacement) => {
  const root = mkdtempSync(join(fixtureDirectory, '.sse-timer-'))
  try {
    const file = join(root, 'route.ts')
    writeFileSync(
      file,
      `import {PassThrough} from 'node:stream';
      declare const app:any;declare function opaque(value:unknown):void;
      declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
      function fresh(){const stream=new PassThrough();return {stream}}
      app.route('/events').get(()=>{const {stream}=fresh();
        ${replacement}
        const interval=setInterval(()=>{},2000);opaque(interval);${frame('stream')}})`,
    )
    const program = ts.createProgram([file], {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
      typeRoots: [nodeTypeRoots],
      types: ['node'],
    })
    expect(ts.getPreEmitDiagnostics(program)).toEqual([])
    expect(() => discoverApiResponseContracts(program, [program.getSourceFile(file)!])).toThrow(
      'unmarked frame',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it.each([
  'selected-direct',
  'incremented-owner',
  'decremented-owner',
  'incremented-factory',
  'decremented-factory',
  'selected-const-alias',
  'selected-cast-alias',
  'selected-assigned-cast-alias',
  'selected-destructured-alias',
  'selected-destructured-cast-alias',
  'selected-container-alias',
  'same-type-opaque-unknown',
  'callback-after-assignment',
  'borrowed-destructure-after-call',
  'borrowed-assignment-after-call',
  'custom-constructor-after-call',
  'reassigned-destructure-after-call',
  'spread-overrides-fresh-stream',
  'reassigned-constructor-before-call',
  'helper-return-cast-alias',
  'object-container-cast-alias',
  'reassigned-factory-before-call',
  'assignment-inside-loop',
  'selected-property-reassigned',
  'selected-owner-for-of-write',
  'conditional-selected-alias',
  'return-nonobject-factory',
  'computed-return-property',
  'factory-call-return-property',
  'bare-factory-return',
  'factory-member-call',
  'constructor-expression',
  'local-timer-returning-selected-stream',
  'callback-returns-selected-stream',
  'function-declaration-returns-stream',
  'function-expression-returns-stream',
  'owner-outside-route-handler',
] as const)('rejects opaque output when %s may pass the selected stream', (name) => {
  expect(() => discover(name)).toThrow('unmarked frame')
})
