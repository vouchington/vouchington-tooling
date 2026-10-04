import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { opaqueProtocolCallbackPath } from './protocol-opaque-callback.mts'

const header = `declare const app:any;declare function mark(name:string):void;
declare function opaque(callback:any):void;declare const dynamicCall:any;declare function tick():void;`
const route = (body: string) => `${header}app.route('/x').get(()=>{${body}})`
const cases = {
  direct: [route(`opaque(()=>mark('direct'))`), true],
  alias: [route(`const callback=()=>mark('alias');opaque(callback)`), true],
  options: [route(`opaque({emit:()=>mark('options')})`), true],
  shorthand: [route(`const emit=()=>mark('shorthand');opaque({emit})`), true],
  method: [route(`opaque({emit(){mark('method')}})`), true],
  nested: [route(`opaque(()=>opaque(()=>mark('nested')))`), true],
  anyCallee: [route(`dynamicCall(()=>mark('any-callee'))`), true],
  ignoredAsAny: [
    route(`function ignore(callback:()=>void){};(ignore as any)(()=>mark('ignored-any'))`),
    false,
  ],
  forwarded: [
    route(`function forward(callback:()=>void){opaque(callback)}forward(()=>mark('forwarded'))`),
    true,
  ],
  destructured: [
    route(
      `function forward({run}:{run:()=>void}){opaque(run)}forward({run:()=>mark('destructured')})`,
    ),
    true,
  ],
  destructuredChain: [
    route(
      `function relay({run}:{run:()=>void}){opaque(run)}function forward(callback:()=>void){relay({run:callback})}forward(()=>mark('destructured-chain'))`,
    ),
    true,
  ],
  destructuredIgnore: [
    route(`function ignore({run}:{run:()=>void}){}ignore({run:()=>mark('destructured-ignore')})`),
    false,
  ],
  optionalDestructure: [
    route(
      `function forward({run,unused}:{run:()=>void,unused?:()=>void}){opaque(run)}forward({run:()=>mark('optional')})`,
    ),
    true,
  ],
  renamedDestructure: [
    route(
      `function forward({'run':callback}:{run:()=>void}){opaque(callback)}forward({run:()=>mark('renamed')})`,
    ),
    true,
  ],
  nestedDestructure: [
    route(
      `function forward({nested:{run}}:{nested:{run:()=>void}}){opaque(run)}forward({nested:{run:()=>mark('nested-destructure')}})`,
    ),
    true,
  ],
  restDestructure: [
    route(
      `function forward({run,...rest}:{run:()=>void}){opaque(run)}forward({run:()=>mark('rest')})`,
    ),
    true,
  ],
  defaultDestructure: [
    route(
      `function forward({run=()=>{}}:{run?:()=>void}){opaque(run)}forward({run:()=>mark('default')})`,
    ),
    true,
  ],
  computedDestructure: [
    route(
      `const key='run';function forward({[key]:run}:{run:()=>void}){opaque(run)}forward({run:()=>mark('computed')})`,
    ),
    true,
  ],
  arrayParameter: [
    route(
      `function forward([value]:number[],callback:()=>void){opaque(callback)}forward([1],()=>mark('array'))`,
    ),
    true,
  ],
  spreadParameter: [
    route(
      `function forward(first:unknown,callback:()=>void){opaque(callback)}const values:[unknown]=[null];forward(...values,()=>mark('spread'))`,
    ),
    true,
  ],
  nestedForward: [
    route(
      `const outer=()=>{function forward(callback:()=>void){opaque(callback)}forward(()=>mark('nested-forward'))};opaque(outer)`,
    ),
    true,
  ],
  forwardedChain: [
    route(
      `function ignore(callback:()=>void){}function forward(callback:()=>void,unused?:()=>void){tick();ignore(callback);relay(callback)}function relay(callback:()=>void,unused?:()=>void){opaque(callback)}forward(()=>mark('forwarded-chain'))`,
    ),
    true,
  ],
  nestedUnused: [
    route(
      `function forward(callback:()=>void){function never(){opaque(callback)}}forward(()=>mark('nested-unused'))`,
    ),
    false,
  ],
  implementedIgnore: [
    route(`function ignore(callback:()=>void){}ignore(()=>mark('ignored'))`),
    false,
  ],
  implementedConsume: [
    route(`function consume(callback:()=>void){callback()}consume(()=>mark('consumed'))`),
    false,
  ],
  dead: [route(`if(false)opaque(()=>mark('dead'))`), false],
  afterReturn: [route(`return;opaque(()=>mark('after-return'))`), false],
  unused: [route(`const callback=()=>mark('unused')`), false],
  uncalledOuter: [route(`function unused(){opaque(()=>mark('outer-unused'))}`), false],
  uncalledAlias: [
    route(`const callback=()=>mark('uncalled-alias');function never(){opaque(callback)}`),
    false,
  ],
  generator: [route(`opaque(function*(){mark('generator')})`), false],
  topLevelDead: [`${header}if(false)mark('top-level-dead');export {}`, false],
} as const

function results() {
  const root = mkdtempSync(join(tmpdir(), 'opaque-callback-'))
  try {
    const files = Object.fromEntries(
      Object.entries(cases).map(([name, [source]]) => {
        const file = join(root, `${name}.ts`)
        writeFileSync(file, `${source}\nexport {}`)
        return [name, file]
      }),
    ) as Record<keyof typeof cases, string>
    const program = ts.createProgram(Object.values(files), {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    })
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    ).toEqual([])
    const checker = program.getTypeChecker()
    return Object.fromEntries(
      Object.entries(files).map(([name, file]) => {
        let marker: ts.CallExpression | undefined
        function visit(node: ts.Node) {
          if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'mark'
          )
            marker = node
          ts.forEachChild(node, visit)
        }
        visit(program.getSourceFile(file)!)
        if (!marker) throw new Error(`Missing callback marker: ${name}`)
        return [name, opaqueProtocolCallbackPath(marker, checker)]
      }),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

it('proves callback paths that escape opaque consumers without accepting deferred or ignored callbacks', () => {
  const actual = results()
  for (const [name, [, expected]] of Object.entries(cases)) expect(actual[name]).toBe(expected)
})
