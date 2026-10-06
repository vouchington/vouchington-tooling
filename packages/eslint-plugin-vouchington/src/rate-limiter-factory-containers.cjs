'use strict'
const {
  executionFunction,
  lifecycleMayReachRateLimiter,
  mayReachRateLimiter,
  position,
} = require('./rate-limiter-writes.cjs')
const { possibleResults } = require('./rate-limiter-branches.cjs')
const { createContainerAst } = require('./rate-limiter-container-ast.cjs')
const { createContainerWrites } = require('./rate-limiter-container-writes.cjs')
const { createFactoryReturnProvenance, rootedMemberPath } = require('./rate-limiter-factories.cjs')
const { literalMemberCandidates } = require('./rate-limiter-literals.cjs')
const { resolveKnownSpread } = require('./rate-limiter-spreads.cjs')
function createFactoryCallTracker({
  context,
  findVariable,
  isRateLimiterValue,
  propertyName,
  unwrap,
}) {
  const active = new Map()
  const activeLiterals = new Map()
  const { memberAccess, remainingAssignedPath } = createContainerAst({ propertyName, unwrap })
  const { candidateWrites } = createContainerWrites({
    context,
    findVariable,
    memberAccess,
    position,
    propertyName,
    remainingAssignedPath,
    unwrap,
  })
  const { callReturnsLimiter, calleeReturnsLimiter } = createFactoryReturnProvenance({
    findVariable,
    resolveMemberCallee: memberCalleeReturnsLimiter,
    resolveMemberValue: (_context, value, path, cutoff, isReceiver, visitedFactories) =>
      valuePathReturnsLimiter(value, path, cutoff, isReceiver, visitedFactories),
    unwrap,
  })
  function literalPathReturnsLimiter(value, path, isReceiver, visitedFactories) {
    const token = JSON.stringify(path)
    const tokens = activeLiterals.get(value) ?? new Set()
    if (tokens.has(token)) return false
    tokens.add(token)
    activeLiterals.set(value, tokens)
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
    try {
      return inspect(value, path).candidates.some((candidate) =>
        valuePathReturnsLimiter(
          candidate.node,
          candidate.path,
          candidate.node,
          isReceiver,
          visitedFactories,
        ),
      )
    } finally {
      tokens.delete(token)
    }
  }

  function valuePathReturnsLimiter(valueNode, path, receiver, isReceiver, visitedFactories) {
    const value = unwrap(valueNode)
    if (!value) return false
    const alternatives = possibleResults(value, unwrap)
    if (alternatives.length !== 1 || alternatives[0] !== value) {
      return alternatives.some((alternative) =>
        valuePathReturnsLimiter(alternative, path, receiver, isReceiver, visitedFactories),
      )
    }
    if (value.type === 'CallExpression') {
      return callReturnsLimiter(
        context,
        value,
        (returned, nextFactories) =>
          valuePathReturnsLimiter(returned, path, returned, isReceiver, nextFactories),
        visitedFactories,
      )
    }
    if (path.length === 0) {
      return calleeReturnsLimiter(context, value, receiver, isReceiver, visitedFactories)
    }
    if (value.type === 'Identifier') {
      const variable = findVariable(context, value)
      return Boolean(
        variable &&
        variablePathReturnsLimiter(variable, path, receiver, isReceiver, visitedFactories),
      )
    }
    if (value.type === 'MemberExpression') {
      const access = memberAccess(value)
      const variable = access && findVariable(context, access.root)
      return Boolean(
        variable &&
        variablePathReturnsLimiter(
          variable,
          [...access.path, ...path],
          receiver,
          isReceiver,
          visitedFactories,
        ),
      )
    }
    if (value.type === 'ObjectExpression' || value.type === 'ArrayExpression') {
      return literalPathReturnsLimiter(value, path, isReceiver, visitedFactories)
    }
    return false
  }

  function variablePathReturnsLimiter(variable, path, receiver, isReceiver, visitedFactories) {
    const token = `${JSON.stringify(path)}:${position(receiver)}`
    const tokens = active.get(variable) ?? new Set()
    if (tokens.has(token)) return false
    tokens.add(token)
    active.set(variable, tokens)
    try {
      const writes = candidateWrites(variable, path)
      const prior = writes.filter((write) => position(write.identifier) < position(receiver))
      const classifier = (expression, write) =>
        valuePathReturnsLimiter(
          expression,
          write.accessPath ?? [],
          write.identifier,
          isReceiver,
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

  function memberCalleeReturnsLimiter(_context, member, cutoff, isReceiver, visitedFactories) {
    const access = memberAccess(member)
    if (access) {
      const variable = findVariable(context, access.root)
      return Boolean(
        variable &&
        variablePathReturnsLimiter(variable, access.path, cutoff, isReceiver, visitedFactories),
      )
    }
    const { path, root } = rootedMemberPath(member, propertyName, unwrap)
    return (
      root?.type === 'CallExpression' &&
      callReturnsLimiter(
        context,
        root,
        (returned, nextFactories) =>
          valuePathReturnsLimiter(returned, path, returned, isReceiver, nextFactories),
        visitedFactories,
      )
    )
  }
  function callMayReturnRateLimiter(call, path, visitedFactories) {
    return callReturnsLimiter(
      context,
      call,
      (returned, nextFactories) => isRateLimiterValue(returned, path, nextFactories),
      visitedFactories,
    )
  }
  function callRootedMemberMayReturnRateLimiter(node, visitedFactories) {
    const { path, root } = rootedMemberPath(node, propertyName, unwrap)
    return Boolean(
      root?.type === 'CallExpression' && callMayReturnRateLimiter(root, path, visitedFactories),
    )
  }
  return { callMayReturnRateLimiter, callRootedMemberMayReturnRateLimiter }
}
module.exports = { createFactoryCallTracker }
