'use strict'
const {
  executionFunction,
  lifecycleMayReachRateLimiter,
  mayReachRateLimiter,
  position,
} = require('./rate-limiter-writes.cjs')
const { possibleResults } = require('./rate-limiter-branches.cjs')
const { createFactoryCallTracker } = require('./rate-limiter-factory-containers.cjs')
const { literalMemberCandidates } = require('./rate-limiter-literals.cjs')
const { resolveKnownSpread } = require('./rate-limiter-spreads.cjs')
const { createContainerAst } = require('./rate-limiter-container-ast.cjs')
const { createContainerWrites } = require('./rate-limiter-container-writes.cjs')
function createValueTracker({
  context,
  findVariable,
  isDirectRateLimiter,
  isDirectRateLimiterAtPath,
  propertyName,
  unwrap,
}) {
  const active = new Map()
  const { iterationSource, memberAccess, remainingAssignedPath } = createContainerAst({
    propertyName,
    unwrap,
  })
  const { candidateWrites } = createContainerWrites({
    context,
    findVariable,
    memberAccess,
    position,
    propertyName,
    remainingAssignedPath,
    unwrap,
  })
  const { callMayReturnRateLimiter, callRootedMemberMayReturnRateLimiter } =
    createFactoryCallTracker({
      context,
      findVariable,
      isRateLimiterValue: (node, path, visitedFactories) =>
        valueMayBeRateLimiter(node, path, node, visitedFactories),
      propertyName,
      unwrap,
    })
  function literalValueMayBeRateLimiter(value, path, visitedFactories) {
    const inspect = (candidate, candidatePath, spreadVisited = new Set()) =>
      literalMemberCandidates(candidate, candidatePath, unwrap, (spread, spreadPath) =>
        resolveKnownSpread(
          context,
          unwrap(spread),
          spreadPath,
          findVariable,
          (nested, nestedPath, nextVisited) => inspect(nested, nestedPath, nextVisited),
          spreadVisited,
        ),
      )
    return inspect(value, path).candidates.some((candidate) =>
      candidate.node === value &&
      candidate.path.length === path.length &&
      candidate.path.every((part, index) => part === path[index])
        ? false
        : valueMayBeRateLimiter(candidate.node, candidate.path, candidate.node, visitedFactories),
    )
  }
  function collectionMayYieldRateLimiter({ collection, path }, receiver, visitedFactories) {
    const value = unwrap(collection)
    const collectionCallee = unwrap(value?.callee)
    const collectionOwner = collectionCallee?.object
    const collectionMethod =
      collectionCallee?.type === 'MemberExpression' ? propertyName(collectionCallee) : null
    const isGlobalObjectCall =
      value?.type === 'CallExpression' &&
      collectionCallee?.type === 'MemberExpression' &&
      collectionOwner?.type === 'Identifier' &&
      collectionOwner.name === 'Object' &&
      !findVariable(context, collectionOwner)?.defs?.length
    if (isGlobalObjectCall && collectionMethod === 'values') {
      return valueMayBeRateLimiter(value.arguments[0], [null, ...path], receiver, visitedFactories)
    }
    if (
      isGlobalObjectCall &&
      collectionMethod === 'entries' &&
      (path[0] === 1 || path[0] === null)
    ) {
      return valueMayBeRateLimiter(
        value.arguments[0],
        [null, ...path.slice(1)],
        receiver,
        visitedFactories,
      )
    }
    return valueMayBeRateLimiter(value, [null, ...path], receiver, visitedFactories)
  }
  function variablePathMayBeRateLimiter(variable, path, receiver, visitedFactories) {
    const token = `${JSON.stringify(path)}:${position(receiver)}`
    const tokens = active.get(variable) ?? new Set()
    if (tokens.has(token)) return false
    tokens.add(token)
    active.set(variable, tokens)
    try {
      const source = iterationSource(variable)
      if (
        source &&
        collectionMayYieldRateLimiter(
          { collection: source.collection, path: [...source.path, ...path] },
          receiver,
          visitedFactories,
        )
      ) {
        return true
      }
      const writes = candidateWrites(variable, path)
      const prior = writes.filter((write) => position(write.identifier) < position(receiver))
      const classifier = (expression, write) =>
        valueMayBeRateLimiter(
          expression,
          write.accessPath ?? [],
          write.identifier,
          visitedFactories,
        )
      const readExecution = executionFunction(receiver)
      const sameExecution = prior.filter(
        (write) => executionFunction(write.identifier) === readExecution,
      )
      if (mayReachRateLimiter(sameExecution, receiver, classifier)) return true
      const definitionExecution = executionFunction(variable.identifiers[0])
      const definingExecution = prior.filter(
        (write) => executionFunction(write.identifier) === definitionExecution,
      )
      return (
        mayReachRateLimiter(definingExecution, receiver, classifier) ||
        lifecycleMayReachRateLimiter(variable, receiver, classifier, writes)
      )
    } finally {
      tokens.delete(token)
    }
  }
  function valueMayBeRateLimiter(node, path = [], receiver = node, visitedFactories = new Set()) {
    const value = unwrap(node)
    if (!value) return false
    const alternatives = possibleResults(value, unwrap)
    if (alternatives.length !== 1 || alternatives[0] !== value) {
      return alternatives.some((alternative) =>
        valueMayBeRateLimiter(alternative, path, receiver, visitedFactories),
      )
    }
    if (path.length === 0 && isDirectRateLimiter(value)) return true
    if (isDirectRateLimiterAtPath?.(value, path)) return true
    if (
      value.type === 'CallExpression' &&
      callMayReturnRateLimiter(value, path, visitedFactories)
    ) {
      return true
    }
    if (value.type === 'Identifier') {
      const variable = findVariable(context, value)
      return Boolean(
        variable && variablePathMayBeRateLimiter(variable, path, receiver, visitedFactories),
      )
    }
    if (value.type === 'MemberExpression') {
      const access = memberAccess(value)
      if (!access) {
        return (
          valueMayBeRateLimiter(
            value.object,
            [propertyName(value), ...path],
            receiver,
            visitedFactories,
          ) || callRootedMemberMayReturnRateLimiter(value, visitedFactories)
        )
      }
      const variable = findVariable(context, access.root)
      return Boolean(
        variable &&
        variablePathMayBeRateLimiter(
          variable,
          [...access.path, ...path],
          receiver,
          visitedFactories,
        ),
      )
    }
    if (path.length === 0) return false
    if (value.type === 'ObjectExpression' || value.type === 'ArrayExpression') {
      return literalValueMayBeRateLimiter(value, path, visitedFactories)
    }
    return false
  }
  return { valueMayBeRateLimiter }
}
module.exports = { createValueTracker }
