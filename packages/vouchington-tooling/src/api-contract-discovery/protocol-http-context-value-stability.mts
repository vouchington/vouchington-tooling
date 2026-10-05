import { createContextReceiverChecks } from './protocol-http-context-receiver-checks.mts'
import { contextMutationTargets } from './protocol-http-context-write-targets.mts'
import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { contextFunctionOwns } from './protocol-http-context-capture.mts'
import { createContextValueRoots } from './protocol-http-context-value-roots.mts'
import { isProtocolCallbackFunction } from './protocol-callback-values.mts'
import { createLiteralWrapperIndex } from './protocol-http-context-literal-wrappers.mts'
import {
  createContextForwardedArguments,
  contextForwardedTarget,
} from './protocol-http-context-forwarded-target.mts'
import { createContextConsumerSources } from './protocol-http-context-consumer-sources.mts'
import { createContextRequiredModule } from './protocol-http-context-require.mts'

type Facts = {
  writes: ts.Expression[]
  calls: (ts.CallExpression | ts.NewExpression)[]
  tagged: Set<ts.Symbol>
  wrappers: ReturnType<typeof createLiteralWrapperIndex>
}
/** One proof indexes source mutations once; aliases and forwarded parameters retain their roots. */
export function createContextValueStability(
  checker: ts.TypeChecker,
  programSources?: readonly ts.SourceFile[],
  compilerOptions?: ts.CompilerOptions,
) {
  const requiredModule = createContextRequiredModule(checker, programSources, compilerOptions)
  const roots = createContextValueRoots(checker, requiredModule)
  const { root, primitiveMember } = roots
  const cache = new Map<ts.Symbol, boolean>()
  const sources = new Map<ts.SourceFile, Facts>()
  const consumerSources = createContextConsumerSources(checker, programSources, requiredModule)
  const forwardedArguments = createContextForwardedArguments(checker)
  function capturedContainer(
    symbol: ts.Symbol,
    owner?: ts.Node,
    seen = new Set<ts.Symbol>(),
  ): boolean {
    if (seen.has(symbol)) return true
    const declaration = symbol.valueDeclaration
    const value =
      declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
        ? unwrapExpression(declaration.initializer)
        : declaration
    if (!value || isProtocolCallbackFunction(value)) return false
    if (owner && declaration && contextFunctionOwns(declaration, owner)) {
      if (ts.isParameter(declaration)) return false
      return [...facts(declaration.getSourceFile()).wrappers.capture(value)].some((captured) =>
        capturedContainer(captured, owner, new Set(seen).add(symbol)),
      )
    }
    const name =
      declaration && (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration))
        ? declaration.name
        : undefined
    return !(name && ts.isIdentifier(name) && roots.primitiveValue(name))
  }
  function facts(source: ts.SourceFile): Facts {
    const hit = sources.get(source)
    if (hit) return hit
    const result: Facts = {
      writes: [],
      calls: [],
      tagged: new Set(),
      wrappers: createLiteralWrapperIndex(checker, roots),
    }
    function visit(node: ts.Node) {
      result.wrappers.record(node)
      result.writes.push(...contextMutationTargets(node))
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) result.calls.push(node)
      if (ts.isTaggedTemplateExpression(node) && ts.isTemplateExpression(node.template))
        for (const span of node.template.templateSpans)
          if (!primitiveMember(span.expression))
            for (const symbol of result.wrappers.capture(span.expression)) result.tagged.add(symbol)
      ts.forEachChild(node, visit)
    }
    visit(source)
    sources.set(source, result)
    return result
  }
  function stable(symbol: ts.Symbol, active = new Set<ts.Symbol>()): boolean {
    const hit = cache.get(symbol)
    if (hit !== undefined) return hit
    const declaration = symbol.valueDeclaration
    if (!declaration || active.has(symbol)) return false
    if (declaration.getSourceFile().isDeclarationFile) {
      cache.set(symbol, false)
      return false
    }
    const next = new Set(active).add(symbol)
    const allData = consumerSources(declaration.getSourceFile()).map(facts)
    const value =
      ts.isVariableDeclaration(declaration) && declaration.initializer
        ? unwrapExpression(declaration.initializer)
        : declaration
    const declarationData = facts(declaration.getSourceFile())
    const captures = declarationData.wrappers.capture(value)
    const immutableFunction =
      isProtocolCallbackFunction(value) &&
      ![...captures].some((captured) => capturedContainer(captured, value))
    const module = checker.getSymbolAtLocation(declaration.getSourceFile())
    let safe =
      !!programSources ||
      immutableFunction ||
      !module ||
      !checker
        .getExportsOfModule(module)
        .some(
          (item) =>
            (item.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item) === symbol,
        )
    for (const data of allData) {
      if (
        data.wrappers.returnedParameters.has(symbol) ||
        data.writes.some((expression) => roots.referencesContainer(expression, symbol, module))
      )
        safe = false
      if (!immutableFunction) {
        if (data.wrappers.stored.has(symbol)) safe = false
        if (data.tagged.has(symbol)) safe = false
        for (const wrapper of data.wrappers.parents.get(symbol) ?? [])
          if (!stable(wrapper, next)) safe = false
      }
      // Function bodies are immutable, but foreign callers may receive their returned containers.
      for (const call of immutableFunction ? [] : data.calls) {
        if (!safe) break
        if (
          isProtocolCallbackFunction(value) &&
          root(call.expression) === symbol &&
          [...captures].some((captured) => capturedContainer(captured, value))
        )
          safe = false
        for (const [index, argument] of forwardedArguments(call).entries()) {
          if (!argument) continue
          if (
            !roots.referencesContainer(argument, symbol, module, data.wrappers.capture(argument)) ||
            primitiveMember(argument)
          )
            continue
          if (
            ts.isPropertyAccessExpression(call.expression) &&
            [
              'assign',
              'set',
              'defineProperty',
              'defineProperties',
              'deleteProperty',
              'setPrototypeOf',
            ].includes(call.expression.name.text)
          ) {
            safe = false
            continue
          }
          const target = contextForwardedTarget(checker, call, index)
          if (!target || !stable(target.binding, next)) safe = false
        }
      }
    }
    cache.set(symbol, safe)
    return safe
  }
  const receivers = createContextReceiverChecks(
    checker,
    roots,
    (symbol) => consumerSources(symbol.valueDeclaration!.getSourceFile()).map(facts),
    stable,
    (symbol) => {
      const declaration = symbol.valueDeclaration!
      const value =
        ts.isVariableDeclaration(declaration) && declaration.initializer
          ? unwrapExpression(declaration.initializer)
          : declaration
      return (
        isProtocolCallbackFunction(value) &&
        ![...facts(declaration.getSourceFile()).wrappers.capture(value)].some((captured) =>
          capturedContainer(captured, value),
        )
      )
    },
  )
  return Object.assign(stable, { receivers })
}
