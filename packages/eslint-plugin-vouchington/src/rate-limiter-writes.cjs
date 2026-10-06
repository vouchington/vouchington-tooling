'use strict'

const { executionFunction } = require('./rate-limiter-execution.cjs')

const BRANCHING_ANCESTORS = new Set([
  'CatchClause',
  'ConditionalExpression',
  'DoWhileStatement',
  'ForInStatement',
  'ForOfStatement',
  'ForStatement',
  'FunctionDeclaration',
  'FunctionExpression',
  'IfStatement',
  'LogicalExpression',
  'ArrowFunctionExpression',
  'SwitchCase',
  'SwitchStatement',
  'TryStatement',
  'WhileStatement',
])

function position(node) {
  return node.range?.[0] ?? node.start ?? -1
}

function ancestorContainers(node) {
  const containers = []
  let current = node?.parent
  while (current) {
    if (current.type === 'BlockStatement' || current.type === 'Program') {
      containers.push(current)
    }
    current = current.parent
  }
  return containers
}

function commonContainer(write, receiver) {
  const writeContainers = new Set(ancestorContainers(write))
  return ancestorContainers(receiver).find((container) => writeContainers.has(container)) ?? null
}

function isUnconditionalWithin(write, container) {
  let current = write.parent
  while (current && current !== container) {
    if (BRANCHING_ANCESTORS.has(current.type)) return false
    current = current.parent
  }
  return current === container
}

function mayReachRateLimiter(
  writes,
  receiver,
  isRateLimiterConstruction,
  containerOverride,
  compareWrites = (left, right) => position(left.identifier) - position(right.identifier),
) {
  const ordered = writes.toSorted(compareWrites)
  let lastUnconditional = null
  let lastUnconditionalIndex = -1
  for (const [index, write] of ordered.entries()) {
    const container =
      typeof containerOverride === 'function'
        ? containerOverride(write)
        : (containerOverride ?? commonContainer(write.identifier, receiver))
    if (
      container &&
      !write.forceConditional &&
      isUnconditionalWithin(write.identifier, container)
    ) {
      lastUnconditional = write
      lastUnconditionalIndex = index
    }
  }
  if (
    lastUnconditional &&
    isRateLimiterConstruction(lastUnconditional.writeExpr, lastUnconditional)
  ) {
    return true
  }
  return ordered
    .slice(lastUnconditionalIndex + 1)
    .some((write) => isRateLimiterConstruction(write.writeExpr, write))
}

function priorWrites(variable, receiver, predicate) {
  const receiverPosition = position(receiver)
  return variable.references.filter(
    (reference) =>
      reference.isWrite() &&
      position(reference.identifier) < receiverPosition &&
      predicate(reference),
  )
}

function enclosingHook(node, names) {
  let current = node
  while (current) {
    if (
      (current.type === 'ArrowFunctionExpression' || current.type === 'FunctionExpression') &&
      current.parent?.type === 'CallExpression' &&
      current.parent.arguments[0] === current &&
      current.parent.callee.type === 'Identifier' &&
      names.has(current.parent.callee.name)
    ) {
      const call = current.parent
      const statement = call.parent?.type === 'ExpressionStatement' ? call.parent : call
      return { callback: current, name: call.callee.name, position: position(statement), statement }
    }
    current = current.parent
  }
  return null
}

function lifecycleMayReachRateLimiter(
  variable,
  receiver,
  isRateLimiterConstruction,
  candidateWrites = variable.references.filter((reference) => reference.isWrite()),
) {
  const cleanup = enclosingHook(receiver, new Set(['afterEach', 'afterAll']))
  if (!cleanup) return false
  const setupContainers = new Map()
  const setupOrder = new Map()
  const setupWrites = []
  for (const write of candidateWrites) {
    const setup = enclosingHook(write.identifier, new Set(['beforeEach', 'beforeAll']))
    if (!setup || setup.statement.parent !== cleanup.statement.parent) {
      continue
    }
    setupWrites.push(write)
    setupContainers.set(
      write,
      setup.callback.body.type === 'BlockStatement' ? setup.callback.body : null,
    )
    setupOrder.set(write, {
      phase: setup.name === 'beforeAll' ? 0 : 1,
      position: setup.position,
    })
  }
  return mayReachRateLimiter(
    setupWrites,
    receiver,
    isRateLimiterConstruction,
    (write) => setupContainers.get(write),
    (left, right) => {
      const leftOrder = setupOrder.get(left)
      const rightOrder = setupOrder.get(right)
      return leftOrder.phase - rightOrder.phase || leftOrder.position - rightOrder.position
    },
  )
}

module.exports = {
  commonContainer,
  executionFunction,
  isUnconditionalWithin,
  lifecycleMayReachRateLimiter,
  mayReachRateLimiter,
  position,
  priorWrites,
}
