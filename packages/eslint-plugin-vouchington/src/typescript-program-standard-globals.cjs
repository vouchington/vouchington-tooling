'use strict'

function isGlobalIdentifier(context, value, name, findVariable) {
  return (
    value?.type === 'Identifier' &&
    value.name === name &&
    !findVariable(context, value)?.defs?.length
  )
}

function isGlobalMember(context, value, objectName, memberName, findVariable, propertyName) {
  return (
    value?.type === 'MemberExpression' &&
    propertyName(value) === memberName &&
    isGlobalIdentifier(context, value.object, objectName, findVariable)
  )
}

function isGlobalFunctionMethod(context, value, methods, findVariable, propertyName) {
  return (
    value?.type === 'MemberExpression' &&
    (methods.has?.(propertyName(value)) || propertyName(value) === methods) &&
    value.object?.type === 'MemberExpression' &&
    propertyName(value.object) === 'prototype' &&
    isGlobalIdentifier(context, value.object.object, 'Function', findVariable)
  )
}

module.exports = { isGlobalIdentifier, isGlobalMember, isGlobalFunctionMethod }
