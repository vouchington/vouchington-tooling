'use strict'

const { executionFunction } = require('./rate-limiter-execution.cjs')
const { possibleResults } = require('./rate-limiter-branches.cjs')
const { receiverAtPath } = require('./rate-limiter-extractions.cjs')
const { patternSourceExpression } = require('./rate-limiter-patterns.cjs')
const { lifecycleMayReachRateLimiter, mayReachRateLimiter } = require('./rate-limiter-writes.cjs')

const NODE_MODULE_SPECIFIERS = new Set(['module', 'node:module'])

function position(node) {
  return node.range?.[0] ?? node.start ?? -1
}

function hasNodeModuleImport(variable, specifierType, importedName) {
  return Boolean(
    variable?.defs?.some((definition) => {
      const specifier = definition.node
      const declaration = definition.parent || specifier?.parent
      return (
        definition.type === 'ImportBinding' &&
        specifier?.type === specifierType &&
        specifier.importKind !== 'type' &&
        declaration?.type === 'ImportDeclaration' &&
        declaration.importKind !== 'type' &&
        NODE_MODULE_SPECIFIERS.has(declaration.source?.value) &&
        (importedName === undefined ||
          (specifier.imported?.name ?? specifier.imported?.value) === importedName)
      )
    }),
  )
}

function createRequireProvenance({ findVariable, propertyName, unwrap }) {
  function isNodeModuleNamespace(context, node, cutoff, visited = new Set()) {
    const value = unwrap(node)
    if (
      value?.type === 'Identifier' &&
      hasNodeModuleImport(findVariable(context, value), 'ImportNamespaceSpecifier')
    ) {
      return true
    }
    if (value?.type !== 'Identifier') return false
    const variable = findVariable(context, value)
    if (!variable || visited.has(variable)) return false
    const nextVisited = new Set(visited)
    nextVisited.add(variable)
    const prove = (candidate) => isNodeModuleNamespace(context, candidate, candidate, nextVisited)
    const writes = variable.references.filter(
      (reference) => reference.isWrite() && position(reference.identifier) < position(cutoff),
    )
    const readExecution = executionFunction(value)
    const sameExecution = writes.filter(
      (write) => executionFunction(write.identifier) === readExecution,
    )
    if (mayReachRateLimiter(sameExecution, value, prove)) return true
    const definitionExecution = executionFunction(variable.identifiers[0])
    const definingScope = writes.filter(
      (write) => executionFunction(write.identifier) === definitionExecution,
    )
    return (
      mayReachRateLimiter(definingScope, value, prove) ||
      lifecycleMayReachRateLimiter(variable, value, prove, writes)
    )
  }

  function isCreateRequireReference(context, node) {
    const value = unwrap(node)
    if (value?.type === 'Identifier') {
      return hasNodeModuleImport(findVariable(context, value), 'ImportSpecifier', 'createRequire')
    }
    return (
      value?.type === 'MemberExpression' &&
      propertyName(value) === 'createRequire' &&
      isNodeModuleNamespace(context, value.object, value.object)
    )
  }

  function isCreateRequireFactory(context, node, cutoff, visited = new Set()) {
    const value = unwrap(node)
    const results = possibleResults(value, unwrap)
    if (
      (results.length !== 1 || results[0] !== value) &&
      results.some((result) => isCreateRequireFactory(context, result, result, visited))
    ) {
      return true
    }
    if (isCreateRequireReference(context, value)) return true
    if (value?.type !== 'Identifier') return false
    const variable = findVariable(context, value)
    if (!variable || visited.has(variable)) return false
    const nextVisited = new Set(visited)
    nextVisited.add(variable)
    const prove = (candidate) => isCreateRequireFactory(context, candidate, candidate, nextVisited)
    const writes = []
    for (const reference of variable.references) {
      if (!reference.isWrite() || position(reference.identifier) >= position(cutoff)) continue
      const extracted = patternSourceExpression(reference.identifier, [], receiverAtPath, unwrap)
      writes.push(
        extracted
          ? {
              ...reference,
              writeExpr: extracted,
            }
          : reference,
      )
    }
    for (const identifier of variable.identifiers) {
      const extracted = patternSourceExpression(identifier, [], receiverAtPath, unwrap)
      if (
        extracted &&
        position(identifier) < position(cutoff) &&
        !writes.some((write) => position(write.identifier) === position(identifier))
      ) {
        writes.push({
          identifier,
          writeExpr: extracted,
        })
      }
    }
    const readExecution = executionFunction(value)
    const sameExecution = writes.filter(
      (write) => executionFunction(write.identifier) === readExecution,
    )
    if (mayReachRateLimiter(sameExecution, value, prove)) return true
    const definitionExecution = executionFunction(variable.identifiers[0])
    const definingScope = writes.filter(
      (write) => executionFunction(write.identifier) === definitionExecution,
    )
    return (
      mayReachRateLimiter(definingScope, value, prove) ||
      lifecycleMayReachRateLimiter(variable, value, prove, writes)
    )
  }

  function isRequireFunction(context, node, cutoff, visited = new Set()) {
    const value = unwrap(node)
    if (
      value?.type === 'Identifier' &&
      value.name === 'require' &&
      !findVariable(context, value)?.defs?.length
    ) {
      return true
    }
    if (
      value?.type === 'CallExpression' &&
      isCreateRequireFactory(context, value.callee, value.callee)
    ) {
      return true
    }
    if (value?.type !== 'Identifier') return false
    const variable = findVariable(context, value)
    if (!variable || visited.has(variable)) return false
    const nextVisited = new Set(visited)
    nextVisited.add(variable)
    const prove = (candidate) => isRequireFunction(context, candidate, candidate, nextVisited)
    const writes = variable.references.filter(
      (reference) => reference.isWrite() && position(reference.identifier) < position(cutoff),
    )
    const readExecution = executionFunction(value)
    const sameExecution = writes.filter(
      (write) => executionFunction(write.identifier) === readExecution,
    )
    if (mayReachRateLimiter(sameExecution, value, prove)) return true
    const definitionExecution = executionFunction(variable.identifiers[0])
    const definingScope = writes.filter(
      (write) => executionFunction(write.identifier) === definitionExecution,
    )
    return (
      mayReachRateLimiter(definingScope, value, prove) ||
      lifecycleMayReachRateLimiter(variable, value, prove, writes)
    )
  }

  return function isExactRequireCall(context, node, moduleNameOrMatcher) {
    const value = unwrap(node)
    const source = value?.arguments?.[0]?.value
    const matchesModule =
      typeof moduleNameOrMatcher === 'function'
        ? moduleNameOrMatcher(source)
        : source === moduleNameOrMatcher
    return (
      value?.type === 'CallExpression' &&
      value.arguments.length > 0 &&
      value.arguments[0]?.type === 'Literal' &&
      matchesModule &&
      isRequireFunction(context, value.callee, value.callee)
    )
  }
}

module.exports = { createRequireProvenance }
