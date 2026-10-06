'use strict'

const { executionFunction } = require('./rate-limiter-execution.cjs')
const { receiverAtPath } = require('./rate-limiter-extractions.cjs')
const { possibleResults } = require('./rate-limiter-branches.cjs')
const { patternSourceExpression } = require('./rate-limiter-patterns.cjs')
const { lifecycleMayReachRateLimiter, mayReachRateLimiter } = require('./rate-limiter-writes.cjs')

function position(node) {
  return node.range?.[0] ?? node.start ?? -1
}

function returnedValues(factory) {
  if (factory.type === 'ArrowFunctionExpression' && factory.body.type !== 'BlockStatement') {
    return [factory.body]
  }
  const values = []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'ReturnStatement') {
      if (node.argument) values.push(node.argument)
      return
    }
    if (
      node !== factory &&
      (node.type === 'ArrowFunctionExpression' ||
        node.type === 'FunctionExpression' ||
        node.type === 'FunctionDeclaration')
    ) {
      return
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'parent' || key === 'tokens' || key === 'comments') continue
      if (Array.isArray(child)) child.forEach(visit)
      else visit(child)
    }
  }
  visit(factory.body)
  return values
}

function rootedMemberPath(node, propertyName, unwrap) {
  const path = []
  let root = unwrap(node)
  while (root?.type === 'MemberExpression') {
    path.unshift(propertyName(root))
    root = unwrap(root.object)
  }
  return { path, root }
}

function createFactoryReturnProvenance({
  findVariable,
  resolveMemberCallee,
  resolveMemberValue,
  unwrap,
}) {
  function callReturnsLimiter(context, call, isReceiver, visited = new Set()) {
    return calleeReturnsLimiter(context, call.callee, call, isReceiver, visited)
  }

  function calleeReturnsLimiter(context, calleeNode, cutoff, isReceiver, visited = new Set()) {
    const callee = unwrap(calleeNode)
    const alternatives = possibleResults(callee, unwrap)
    if (alternatives.length !== 1 || alternatives[0] !== callee) {
      return alternatives.some((alternative) =>
        calleeReturnsLimiter(context, alternative, cutoff, isReceiver, visited),
      )
    }
    if (
      callee?.type === 'ArrowFunctionExpression' ||
      callee?.type === 'FunctionExpression' ||
      callee?.type === 'FunctionDeclaration'
    ) {
      return returnedValues(callee).some((returned) => isReceiver(returned, visited))
    }
    if (callee?.type === 'Identifier') {
      return variableReturnsLimiter(context, callee, cutoff, isReceiver, visited)
    }
    return callee?.type === 'MemberExpression'
      ? resolveMemberCallee(context, callee, cutoff, isReceiver, visited)
      : false
  }

  function variableReturnsLimiter(context, identifier, cutoff, isReceiver, visited) {
    const variable = findVariable(context, identifier)
    if (!variable || visited.has(variable)) return false
    const nextVisited = new Set(visited)
    nextVisited.add(variable)
    const prove = (value, write) =>
      write.factoryAccessPath
        ? resolveMemberValue(
            context,
            value,
            write.factoryAccessPath,
            value,
            isReceiver,
            nextVisited,
          )
        : calleeReturnsLimiter(context, value, value, isReceiver, nextVisited)
    const hoisted = variable.defs.flatMap((definition) => {
      const declaration = definition.node
      if (declaration?.type !== 'FunctionDeclaration') return []
      return [
        {
          hoisted: true,
          identifier: { parent: declaration.parent, range: [-1, -1] },
          writeExpr: declaration,
        },
      ]
    })
    const bindingWrites = variable.references.flatMap((reference) => {
      if (!reference.isWrite()) return []
      const expression = patternSourceExpression(reference.identifier, [], receiverAtPath, unwrap)
      return [
        expression
          ? {
              identifier: reference.identifier,
              writeExpr: expression,
            }
          : reference,
      ]
    })
    const allCandidates = [...hoisted, ...bindingWrites]
    const prior = allCandidates.filter(
      (write) => write.hoisted || position(write.identifier) < position(cutoff),
    )
    const readExecution = executionFunction(identifier)
    const sameExecution = prior.filter(
      (write) => write.hoisted || executionFunction(write.identifier) === readExecution,
    )
    if (mayReachRateLimiter(sameExecution, identifier, prove)) return true
    const definitionExecution = executionFunction(variable.identifiers[0])
    const definingScope = prior.filter(
      (write) => write.hoisted || executionFunction(write.identifier) === definitionExecution,
    )
    return (
      mayReachRateLimiter(definingScope, identifier, prove) ||
      lifecycleMayReachRateLimiter(variable, identifier, prove, allCandidates)
    )
  }

  return { callReturnsLimiter, calleeReturnsLimiter }
}

module.exports = { createFactoryReturnProvenance, rootedMemberPath }
