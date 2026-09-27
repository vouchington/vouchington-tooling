import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import ts from '../contract-schema/typescript-api.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
import {
  collectHandlerBindings,
  enclosingRouteBinding,
  routeTemplateFromExpression,
  visit,
} from './response-contract-route-analysis.mts'

const sources = {
  routes: `declare const app: any
    function helper(ctx: any) { ctx.json({ helper: true }) }
    app.route('/items').get((ctx: any) => helper(ctx), 1)
    app.other('/ignored').get((ctx: any) => ctx.json({ ignored: true }))
    app.route('/head').head((ctx: any) => ctx.json({ head: true }))
  `,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>
let temporaryDirectory: string | undefined

function expression(text: string): ts.Expression {
  const source = ts.createSourceFile(
    'expression.ts',
    `const value = ${text}`,
    ts.ScriptTarget.Latest,
    true,
  )
  const declaration = (source.statements[0] as ts.VariableStatement).declarationList.declarations[0]
  if (!declaration?.initializer) throw new Error('Expected an expression initializer')
  return declaration.initializer
}

function callNamed(source: ts.SourceFile, name: string): ts.CallExpression {
  let result: ts.CallExpression | undefined
  visit(source, (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === name) result = node
  })
  if (!result) throw new Error(`Missing call ${name}`)
  return result
}

describe('route analysis boundaries', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, 15_000)
  afterAll(() => {
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  it('recognizes only a literal app.route call through a property-access method', () => {
    expect(routeTemplateFromExpression(expression('handler'))).toBeUndefined()
    expect(routeTemplateFromExpression(expression('app.route'))).toBeUndefined()
    expect(routeTemplateFromExpression(expression('app.foo().get'))).toBeUndefined()
    expect(routeTemplateFromExpression(expression('app["route"]("/items").get'))).toBeUndefined()
    expect(routeTemplateFromExpression(expression('app.route(name).get'))).toBeUndefined()
    expect(routeTemplateFromExpression(expression('app.route("/items").get'))).toBe('/items')
  })

  it('ignores a non-route GET registration and a route using an unsupported method', () => {
    const source = matrix.sourceFile('routes')
    const checker = matrix.program.getTypeChecker()
    const bindings = collectHandlerBindings([source], checker)
    expect(bindings.size).toBe(1)
    expect(enclosingRouteBinding(callNamed(source, 'helper'), checker, bindings)).toEqual({
      method: 'GET',
      routeTemplate: '/items',
    })
    const jsonCalls: ts.CallExpression[] = []
    visit(source, (node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'ctx.json')
        jsonCalls.push(node)
    })
    expect(enclosingRouteBinding(jsonCalls[1]!, checker, bindings)).toBeUndefined()
    expect(enclosingRouteBinding(callNamed(source, 'ctx.json'), checker, new Map())).toBeUndefined()
  })

  it('resolves an imported handler alias to the same registered route', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'response-route-alias-'))
    const helperPath = join(temporaryDirectory, 'helper.ts')
    const routesPath = join(temporaryDirectory, 'routes.ts')
    writeFileSync(helperPath, `export function handler(ctx: any) { ctx.json({ alias: true }) }`)
    writeFileSync(
      routesPath,
      `import { handler as renamed } from './helper.js'
      declare const app: any
      app.route('/alias').get(renamed)`,
    )
    const program = ts.createProgram([helperPath, routesPath], {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
    })
    const helper = program.getSourceFile(helperPath)!
    const routes = program.getSourceFile(routesPath)!
    const checker = program.getTypeChecker()
    const bindings = collectHandlerBindings([helper, routes], checker)
    expect(bindings.size).toBe(1)
    expect(enclosingRouteBinding(callNamed(helper, 'ctx.json'), checker, bindings)).toEqual({
      method: 'GET',
      routeTemplate: '/alias',
    })
  })

  it('does not invent a symbol binding for AST nodes outside the supplied Program', () => {
    const detached = ts.createSourceFile(
      'detached.ts',
      `declare const app: any;
       app.route('/detached').get((ctx: any) => missingHandler(ctx));
       app.route('/orphan').get(missingHandler)`,
      ts.ScriptTarget.Latest,
      true,
    )
    const bindings = collectHandlerBindings([detached], matrix.program.getTypeChecker())
    expect(bindings.size).toBe(0)
  })
})
