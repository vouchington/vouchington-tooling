'use strict'
const {
  isGlobalFunctionMethod,
  isGlobalIdentifier,
  isGlobalMember,
} = require('./typescript-program-standard-globals.cjs')
const {
  firstFactoryArgument,
  isFactoryBinder,
  isFactoryMethod,
  isFactoryPathResult,
  isFactoryResult,
} = require('./typescript-program-factory-results.cjs')

function invokedFactory(node, context, findVariable, propertyName, unwrap, isFactoryValue) {
  const callee = unwrap(node.callee)
  if (
    node.type === 'CallExpression' &&
    isGlobalMember(context, callee, 'Reflect', 'apply', findVariable, propertyName)
  ) {
    if (isFactoryValue(node.arguments[0])) return node.arguments[0]
    if (
      isGlobalFunctionMethod(
        context,
        unwrap(node.arguments[0]),
        new Set(['apply', 'call']),
        findVariable,
        propertyName,
      ) &&
      isFactoryValue(node.arguments[1])
    )
      return node.arguments[1]
    if (
      isGlobalMember(
        context,
        unwrap(node.arguments[0]),
        'Reflect',
        'construct',
        findVariable,
        propertyName,
      ) &&
      isGlobalIdentifier(context, node.arguments[1], 'Reflect', findVariable) &&
      firstFactoryArgument(node.arguments[2], isFactoryValue, unwrap)
    )
      return unwrap(node.arguments[2]).elements[0]
    return isFactoryMethod(
      node.arguments[0],
      new Set(['call', 'apply']),
      isFactoryValue,
      propertyName,
      unwrap,
    ) && isFactoryValue(node.arguments[1])
      ? node.arguments[1]
      : null
  }
  if (
    node.type === 'CallExpression' &&
    isGlobalMember(context, callee, 'Reflect', 'construct', findVariable, propertyName)
  ) {
    return isFactoryValue(node.arguments[0]) ? node.arguments[0] : null
  }
  if (
    node.type === 'CallExpression' &&
    callee?.type === 'MemberExpression' &&
    ['call', 'apply'].includes(propertyName(callee))
  ) {
    if (isFactoryValue(callee.object)) return callee.object
    if (
      isGlobalFunctionMethod(context, callee.object, 'call', findVariable, propertyName) &&
      isFactoryValue(node.arguments[0])
    )
      return node.arguments[0]
    if (
      isGlobalFunctionMethod(
        context,
        callee.object,
        new Set(['call', 'apply']),
        findVariable,
        propertyName,
      ) &&
      isFactoryValue(node.arguments[0])
    )
      return node.arguments[0]
    if (
      isGlobalMember(context, callee.object, 'Reflect', 'construct', findVariable, propertyName) &&
      isGlobalIdentifier(context, node.arguments[0], 'Reflect', findVariable)
    ) {
      if (propertyName(callee) === 'call' && isFactoryValue(node.arguments[1]))
        return node.arguments[1]
      if (
        propertyName(callee) === 'apply' &&
        firstFactoryArgument(node.arguments[1], isFactoryValue, unwrap)
      )
        return unwrap(node.arguments[1]).elements[0]
    }
    if (
      isFactoryMethod(
        callee.object,
        new Set(['call', 'apply']),
        isFactoryValue,
        propertyName,
        unwrap,
      ) &&
      isFactoryValue(node.arguments[0])
    )
      return node.arguments[0]
  }
  return node.callee
}

function factoryExecutionVisitors(context, isFactoryValue, reportFactoryInvocation) {
  return {
    NewExpression: reportFactoryInvocation,
    TaggedTemplateExpression(node) {
      if (isFactoryValue(node.tag)) context.report({ messageId: 'constructionOwner', node })
    },
    Decorator(node) {
      if (isFactoryValue(node.expression)) context.report({ messageId: 'constructionOwner', node })
    },
  }
}

function createFactoryInvocation({ context, findVariable, propertyName, unwrap }) {
  const activeHeritage = new Set()
  return {
    executionVisitors: (isFactoryValue, reportFactoryInvocation) =>
      factoryExecutionVisitors(context, isFactoryValue, reportFactoryInvocation),
    invokedFactory: (node, isFactoryValue) =>
      invokedFactory(node, context, findVariable, propertyName, unwrap, isFactoryValue),
    isFactoryBinder: (node, isFactoryValue) =>
      isFactoryBinder(node, context, findVariable, propertyName, unwrap, isFactoryValue),
    isFactoryResult: (node, isFactoryValue, isFactoryBinderValue) =>
      isFactoryResult(
        node,
        context,
        findVariable,
        propertyName,
        unwrap,
        isFactoryValue,
        isFactoryBinderValue,
        activeHeritage,
      ),
    isFactoryPathResult: (node, path, isFactoryValue) =>
      isFactoryPathResult(node, path, context, findVariable, propertyName, unwrap, isFactoryValue),
  }
}

module.exports = { createFactoryInvocation }
