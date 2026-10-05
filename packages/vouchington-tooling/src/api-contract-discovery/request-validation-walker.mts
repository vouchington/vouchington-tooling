import ts from '../contract-schema/typescript-api.mts'
import type { HandlerProof } from './registered-route-handler-analysis.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { httpContextInvocations } from './protocol-http-context-callers.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { isConditionalPosition } from './request-validation-conditional.mts'
import {
  followedImplementations,
  inlineFunction,
  type Scope,
} from './request-validation-follow.mts'
import { findConfig } from './request-validation-match.mts'
import { resolveKey, type KeyBindings } from './request-validation-keys.mts'
import type { Bound, RootBindings } from './request-validation-origin.mts'
import { rawReadsAt } from './request-validation-reads.mts'
import { factorySite, sourceOf, validatorSite } from './request-validation-sites.mts'
import { createStateKey } from './request-validation-state-key.mts'
import { bindArguments } from './request-validation-trace.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'
import type {
  CarrierRead,
  ExecutedCallbackConfig,
  FactoryConfig,
  FactorySite,
  ValidatorConfig,
  ValidatorSite,
} from './request-validation-types.mts'

import { returnedValues } from './request-validation-trace-helpers.mts'

type State = { keys: KeyBindings; roots: RootBindings; conditional: boolean }

type RouteFacts = {
  validatorSites: ValidatorSite[]
  factorySites: FactorySite[]
  carrierReads: CarrierRead[]
}

const emptyState: State = { keys: new Map(), roots: new Map(), conditional: false }

export type WalkerConfig = {
  checker: ts.TypeChecker
  sourceFiles: ReadonlySet<ts.SourceFile>
  validators: readonly ValidatorConfig[]
  factories: readonly FactoryConfig[]
  executedCallbacks: readonly ExecutedCallbackConfig[]
}

/** Walks handlers and the helpers they run, collecting validation facts for one route. */
export function createRouteWalker(config: WalkerConfig) {
  const { checker, sourceFiles, validators, factories, executedCallbacks } = config
  const configured = [...validators, ...factories, ...executedCallbacks]
  const facts: RouteFacts = { validatorSites: [], factorySites: [], carrierReads: [] }
  const reported = new Map<string, object>()
  const visited = new Map<ts.Node, Set<string>>()

  const scopeOf = (state: State): Scope => ({
    checker,
    sourceFiles,
    configured,
    roots: state.roots,
    keys: state.keys,
  })
  /** Adds a fact once; a repeat returns the fact already reported. */
  const report = <T extends object>(
    kind: string,
    target: T[],
    item: T,
    identity: object = item,
  ) => {
    const key = `${kind}${JSON.stringify(identity)}`
    const existing = reported.get(key) as T | undefined
    if (existing) return existing
    reported.set(key, item)
    target.push(item)
    return item
  }
  const stateKey = createStateKey()

  function walkFunction(fn: ts.FunctionLikeDeclaration, state: State) {
    const seen = visited.get(fn) ?? new Set<string>()
    const key = stateKey(state)
    if (seen.has(key)) return
    visited.set(fn, seen.add(key))
    walk(fn.body!, state)
  }

  /** Returns true when the call is a configured validator or factory, whose body is not entered. */
  function visitConfigured(call: ts.CallExpression, state: State): boolean {
    const scope = scopeOf(state)
    const validator = findConfig(call.expression, validators, checker)
    if (validator) {
      const site = validatorSite(
        call,
        validator,
        scope,
        state.conditional || isConditionalPosition(call),
      )
      const { conditional, ...identity } = site
      // A site reached both conditionally and unconditionally is unconditional.
      report('validator', facts.validatorSites, site, identity).conditional &&= conditional
      return true
    }
    const factory = findConfig(call.expression, factories, checker)
    if (factory) report('factory', facts.factorySites, factorySite(call, factory, scope))
    return !!factory
  }

  function walkExecutedCallbacks(call: ts.CallExpression, state: State) {
    const host = findConfig(call.expression, executedCallbacks, checker)
    const argument = host && call.arguments[host.argument]
    const object = argument && unwrapTransparentExpression(argument)
    if (!host || !object || !ts.isObjectLiteralExpression(object)) return
    for (const property of object.properties) {
      const name = property.name && ts.isIdentifier(property.name) ? property.name.text : undefined
      const callback = inlineFunction(
        ts.isPropertyAssignment(property) ? property.initializer : property,
      )
      if (name && host.properties.includes(name) && callback)
        walkFunction(callback, {
          ...state,
          conditional: state.conditional || isConditionalPosition(call),
        })
    }
  }

  function visitCall(call: ts.CallExpression, state: State) {
    const conditional = state.conditional || isConditionalPosition(call)
    const callee = inlineFunction(unwrapTransparentExpression(call.expression))
    if (callee) walkFunction(callee, { ...state, conditional })
    for (const implementation of followedImplementations(call, scopeOf(state))) {
      const { keys, roots } = bindArguments(implementation, call, scopeOf(state))
      walkFunction(implementation, { keys, roots, conditional })
    }
    walkExecutedCallbacks(call, state)
    for (const argument of call.arguments) {
      const callback = unwrapTransparentExpression(argument)
      if (
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        httpContextInvocations(callback, checker).callers.length > 0
      )
        walkFunction(callback, { ...state, conditional })
    }
  }

  function walk(node: ts.Node, state: State) {
    if (!potentiallyExecuted(node)) return
    if (ts.isCallExpression(node) && visitConfigured(node, state)) return
    for (const read of rawReadsAt(node, scopeOf(state)))
      report('read', facts.carrierReads, { ...read, source: sourceOf(node) })
    if (ts.isCallExpression(node)) visitCall(node, state)
    ts.forEachChild(node, (child) => {
      if (!ts.isFunctionLike(child)) walk(child, state)
    })
  }

  /** Finds configured calls in registration-time expressions, without entering handlers. */
  const scanning = new Set<ts.Node>()
  function scanRegistration(node: ts.Node, state: State = emptyState) {
    if (ts.isFunctionLike(node) || (ts.isCallExpression(node) && visitConfigured(node, state)))
      return
    if (ts.isCallExpression(node))
      // A helper that builds the handler: follow its returned values with bound arguments.
      for (const fn of followedImplementations(node, scopeOf(state))) {
        if (scanning.has(fn)) continue
        scanning.add(fn)
        const { keys, roots } = bindArguments(fn, node, scopeOf(state))
        for (const value of returnedValues(fn)) scanRegistration(value, { ...state, keys, roots })
        scanning.delete(fn)
      }
    ts.forEachChild(node, (child) => scanRegistration(child, state))
  }

  return {
    facts,
    scanRegistration,
    walkHandler(proof: HandlerProof) {
      const keys = new Map<ts.Symbol, string>()
      for (const [symbol, expression] of proof.bindings) {
        const key = resolveKey(expression, checker, new Map())
        if (key !== undefined) keys.set(symbol, key)
      }
      const context = runtimeParameters(proof.node)[0]?.name
      const symbol =
        context && ts.isIdentifier(context) ? checker.getSymbolAtLocation(context) : undefined
      const roots = new Map<ts.Symbol, Bound>(
        symbol ? [[symbol, { kind: 'context', origins: [] }]] : [],
      )
      walkFunction(proof.node, { keys, roots, conditional: false })
    },
  }
}
