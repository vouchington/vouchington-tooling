import ts from '../contract-schema/typescript-api.mts'
import type { ProtocolCache } from './protocol-analysis-cache.mts'
import type { HandlerProof } from './registered-route-handler-analysis.mts'
import { handlerBindings } from './request-validation-handler-state.mts'
import { httpContextInvocations } from './protocol-http-context-callers.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import {
  executedCallbackFunctions,
  invokedUnconditionally,
} from './request-validation-callbacks.mts'
import { isConditionalPosition } from './request-validation-conditional.mts'
import {
  followedImplementations,
  inlineFunction,
  type Scope,
} from './request-validation-follow.mts'
import { calledFactory } from './request-validation-factory-calls.mts'
import { findConfig } from './request-validation-match.mts'
import { rawReadsAt } from './request-validation-reads.mts'
import { factorySite, sourceOf, validatorSite } from './request-validation-sites.mts'
import { createReporter } from './request-validation-report.mts'
import { createRegistrationScanner } from './request-validation-registration.mts'
import {
  createStateKey,
  emptyState,
  type WalkState as State,
} from './request-validation-state-key.mts'
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

type RouteFacts = {
  validatorSites: ValidatorSite[]
  factorySites: FactorySite[]
  carrierReads: CarrierRead[]
}

export type WalkerConfig = {
  checker: ts.TypeChecker
  sourceFiles: ReadonlySet<ts.SourceFile>
  validators: readonly ValidatorConfig[]
  factories: readonly FactoryConfig[]
  executedCallbacks: readonly ExecutedCallbackConfig[]
  /** Shared across the routes of one facts run. */
  protocolCache?: ProtocolCache
}

/** Walks handlers and the helpers they run, collecting validation facts for one route. */
export function createRouteWalker(config: WalkerConfig) {
  const { checker, sourceFiles, validators, factories, executedCallbacks, protocolCache } = config
  const configured = [...validators, ...factories, ...executedCallbacks]
  const facts: RouteFacts = { validatorSites: [], factorySites: [], carrierReads: [] }
  const report = createReporter()
  const visited = new Map<ts.Node, Set<string>>()

  const scopeOf = (state: State): Scope => ({
    checker,
    sourceFiles,
    configured,
    roots: state.roots,
    keys: state.keys,
    cache: protocolCache,
  })
  const stateKey = createStateKey()
  const inputs = new Set<ts.Node>()
  const pendingReads: { node: ts.Node; read: CarrierRead; via: ReadonlySet<ts.Node> }[] = []
  const isInput = (node: ts.Node) => {
    for (let current: ts.Node | undefined = node; current; current = current.parent)
      if (inputs.has(current)) return true
    return false
  }

  function walkFunction(fn: ts.FunctionLikeDeclaration, state: State) {
    const seen = visited.get(fn) ?? new Set<string>()
    const key = stateKey(state)
    if (seen.has(key)) return
    visited.set(fn, seen.add(key))
    walk(fn.body!, state)
  }

  /** Records a configured validator call; its input arguments are not raw reads. */
  function reportValidator(call: ts.CallExpression, state: State) {
    const validator = findConfig(call.expression, validators, checker)
    if (!validator) return false
    const { site, inputNodes } = validatorSite(
      call,
      validator,
      scopeOf(state),
      state.conditional || isConditionalPosition(call),
    )
    inputNodes.forEach((node) => inputs.add(node))
    const { conditional, ...identity } = site
    // A site reached both conditionally and unconditionally is unconditional.
    report('validator', facts.validatorSites, site, call, identity).conditional &&= conditional
    return true
  }

  /** Records a factory site once per call node; one reached both ways is unconditional. */
  function recordFactory(
    call: ts.CallExpression,
    factory: FactoryConfig,
    state: State,
    conditional: boolean,
  ) {
    const site = factorySite(call, factory, scopeOf(state), conditional)
    const { conditional: merged, ...identity } = site
    report('factory', facts.factorySites, site, call, identity).conditional &&= merged
  }

  /** Records a configured factory call whose returned handler is a registration-time value. */
  function reportFactory(call: ts.CallExpression, state: State) {
    const factory = findConfig(call.expression, factories, checker)
    if (!factory) return false
    recordFactory(call, factory, state, state.conditional || isConditionalPosition(call))
    return true
  }

  function visitCall(call: ts.CallExpression, state: State) {
    const conditional = state.conditional || isConditionalPosition(call)
    // A handler built by a configured factory at module level and invoked here.
    const built = calledFactory(call, factories, checker)
    if (built) recordFactory(built.call, built.config, emptyState, conditional)
    const inline = inlineFunction(unwrapTransparentExpression(call.expression))
    const callee = inline?.asteriskToken ? undefined : inline
    const via = new Set(state.via).add(call)
    const runners = new Set<ts.Node>(callee ? [callee] : [])
    if (callee) {
      const { keys, roots } = bindArguments(callee, call, scopeOf(state))
      walkFunction(callee, { keys, roots, conditional, via })
    }
    for (const implementation of followedImplementations(call, scopeOf(state))) {
      const { keys, roots } = bindArguments(implementation, call, scopeOf(state))
      runners.add(implementation)
      walkFunction(implementation, { keys, roots, conditional, via })
    }
    // Listed callbacks of a configured host take only the call's own condition.
    for (const callback of executedCallbackFunctions(call, executedCallbacks, checker))
      walkFunction(callback, { ...state, conditional })
    for (const argument of call.arguments) {
      const callback = unwrapTransparentExpression(argument)
      if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) continue
      const { callers } = httpContextInvocations(callback, checker, protocolCache)
      // A helper that runs the callback under its own condition makes the sites conditional.
      if (callers.length > 0)
        walkFunction(callback, {
          ...state,
          conditional: conditional || !invokedUnconditionally(callers, runners),
        })
    }
  }

  function walk(node: ts.Node, state: State) {
    if (!potentiallyExecuted(node)) return
    if (ts.isCallExpression(node)) reportValidator(node, state)
    for (const read of rawReadsAt(node, scopeOf(state)))
      pendingReads.push({ node, read: { ...read, source: sourceOf(node) }, via: state.via })
    if (ts.isCallExpression(node)) visitCall(node, state)
    ts.forEachChild(node, (child) => {
      if (!ts.isFunctionLike(child)) walk(child, state)
    })
  }

  const scanRegistration = createRegistrationScanner(scopeOf, reportFactory)

  return {
    /** The collected facts; reads that only build a validator's input are left out. */
    get facts(): RouteFacts {
      for (const { node, read, via } of pendingReads)
        if (!isInput(node) && ![...via].some(isInput)) report('read', facts.carrierReads, read)
      pendingReads.length = 0
      return facts
    },
    scanRegistration: (node: ts.Node) => scanRegistration(node),
    walkHandler(proof: HandlerProof) {
      walkFunction(proof.node, {
        ...handlerBindings(proof, checker),
        conditional: proof.conditional ?? false,
        via: emptyState.via,
      })
    },
  }
}
