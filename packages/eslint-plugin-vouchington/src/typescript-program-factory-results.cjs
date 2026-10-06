'use strict'
const {
  isGlobalFunctionMethod,
  isGlobalIdentifier,
  isGlobalMember,
} = require('./typescript-program-standard-globals.cjs')

function isFactoryMethod(value, methods, isFactoryValue, propertyName, unwrap) {
  const member = unwrap(value)
  return (
    member?.type === 'MemberExpression' &&
    methods.has(propertyName(member)) &&
    isFactoryValue(member.object)
  )
}

function isFactoryBinder(value, context, findVariable, propertyName, unwrap, isFactoryValue) {
  const node = unwrap(value)
  const callee = unwrap(node?.callee)
  return (
    node?.type === 'CallExpression' &&
    callee?.type === 'MemberExpression' &&
    propertyName(callee) === 'bind' &&
    isFactoryMethod(callee.object, new Set(['bind']), isFactoryValue, propertyName, unwrap) &&
    isFactoryValue(node.arguments[0])
  )
}

function isRevocableProxyCall(value, context, findVariable, propertyName, unwrap, isFactoryValue) {
  const call = unwrap(value)
  return (
    call?.type === 'CallExpression' &&
    isGlobalMember(
      context,
      unwrap(call.callee),
      'Proxy',
      'revocable',
      findVariable,
      propertyName,
    ) &&
    isFactoryValue(call.arguments[0])
  )
}

function revocableProxy(value, context, findVariable, propertyName, unwrap, isFactoryValue) {
  const node = unwrap(value)
  if (node?.type === 'MemberExpression' && propertyName(node) === 'proxy')
    return isRevocableProxyCall(
      node.object,
      context,
      findVariable,
      propertyName,
      unwrap,
      isFactoryValue,
    )
  return false
}

function isFactoryPathResult(
  value,
  path,
  context,
  findVariable,
  propertyName,
  unwrap,
  isFactoryValue,
) {
  return (
    path.at(-1) === 'proxy' &&
    isRevocableProxyCall(value, context, findVariable, propertyName, unwrap, isFactoryValue)
  )
}

function classExtendsFactory(value, context, findVariable, isFactoryValue, activeHeritage) {
  const definition =
    value?.type === 'ClassDeclaration' || value?.type === 'ClassExpression'
      ? value
      : findVariable(context, value)?.defs?.find((candidate) => candidate.type === 'ClassName')
          ?.node
  if (!definition?.superClass) return false
  const identity = findVariable(context, definition.id) ?? definition
  if (activeHeritage.has(identity)) return false
  activeHeritage.add(identity)
  try {
    return isFactoryValue(definition.superClass)
  } finally {
    activeHeritage.delete(identity)
  }
}

function firstFactoryArgument(value, isFactoryValue, unwrap) {
  const array = unwrap(value)
  return array?.type === 'ArrayExpression' && isFactoryValue(array.elements[0])
}

function isFactoryResult(
  node,
  context,
  findVariable,
  propertyName,
  unwrap,
  isFactoryValue,
  isFactoryBinderValue,
  activeHeritage,
) {
  const value = unwrap(node)
  if (
    classExtendsFactory(value, context, findVariable, isFactoryValue, activeHeritage) ||
    revocableProxy(value, context, findVariable, propertyName, unwrap, isFactoryValue)
  )
    return true
  const callee = unwrap(value?.callee)
  if (value?.type === 'NewExpression' && isGlobalIdentifier(context, callee, 'Proxy', findVariable))
    return isFactoryValue(value.arguments[0])
  if (value?.type !== 'CallExpression') return false
  if (isFactoryBinderValue(callee)) return true
  if (isGlobalMember(context, callee, 'Reflect', 'apply', findVariable, propertyName))
    return (
      (isFactoryMethod(
        value.arguments[0],
        new Set(['bind']),
        isFactoryValue,
        propertyName,
        unwrap,
      ) ||
        isGlobalFunctionMethod(
          context,
          unwrap(value.arguments[0]),
          'bind',
          findVariable,
          propertyName,
        )) &&
      isFactoryValue(value.arguments[1])
    )
  if (
    callee?.type === 'MemberExpression' &&
    ['call', 'apply'].includes(propertyName(callee)) &&
    (isFactoryMethod(callee.object, new Set(['bind']), isFactoryValue, propertyName, unwrap) ||
      isGlobalFunctionMethod(context, callee.object, 'bind', findVariable, propertyName)) &&
    isFactoryValue(value.arguments[0])
  )
    return true
  return (
    callee?.type === 'MemberExpression' &&
    propertyName(callee) === 'bind' &&
    (isFactoryValue(callee.object) ||
      (isFactoryMethod(
        callee.object,
        new Set(['call', 'apply']),
        isFactoryValue,
        propertyName,
        unwrap,
      ) &&
        isFactoryValue(value.arguments[0])) ||
      (isGlobalFunctionMethod(
        context,
        callee.object,
        new Set(['call', 'apply']),
        findVariable,
        propertyName,
      ) &&
        isFactoryValue(value.arguments[0])) ||
      (isGlobalMember(context, callee.object, 'Reflect', 'construct', findVariable, propertyName) &&
        isGlobalIdentifier(context, value.arguments[0], 'Reflect', findVariable) &&
        isFactoryValue(value.arguments[1])))
  )
}

module.exports = {
  firstFactoryArgument,
  isFactoryBinder,
  isFactoryMethod,
  isFactoryPathResult,
  isFactoryResult,
}
