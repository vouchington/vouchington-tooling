'use strict'

function createContainerAst({ propertyName, unwrap }) {
  function memberAccess(node) {
    const value = unwrap(node)
    if (value?.type === 'Identifier') return { root: value, path: [] }
    if (value?.type !== 'MemberExpression') return null
    const parent = memberAccess(value.object)
    if (!parent) return null
    return { root: parent.root, path: [...parent.path, propertyName(value)] }
  }

  function bindingPath(pattern, identifier) {
    if (pattern === identifier) return []
    if (pattern?.type === 'AssignmentPattern') return bindingPath(pattern.left, identifier)
    if (pattern?.type === 'RestElement') {
      const nested = bindingPath(pattern.argument, identifier)
      return nested && [null, ...nested]
    }
    if (pattern?.type === 'ObjectPattern') {
      for (const property of pattern.properties) {
        if (property.type === 'RestElement') {
          const nested = bindingPath(property.argument, identifier)
          if (nested) return [null, ...nested]
          continue
        }
        const nested = bindingPath(property.value, identifier)
        if (!nested) continue
        const key =
          property.key.type === 'Literal'
            ? property.key.value
            : !property.computed && property.key.type === 'Identifier'
              ? property.key.name
              : null
        return [key, ...nested]
      }
      return undefined
    }
    if (pattern?.type === 'ArrayPattern') {
      for (const [index, element] of pattern.elements.entries()) {
        const nested = bindingPath(element, identifier)
        if (nested) return [index, ...nested]
      }
    }
    return undefined
  }

  function iterationSource(variable) {
    const identifier = variable.identifiers[0]
    let current = identifier
    while (current?.parent) {
      if (
        current.parent.type === 'ArrowFunctionExpression' ||
        current.parent.type === 'FunctionExpression'
      ) {
        const callback = current.parent
        const call = callback.parent
        const callee = unwrap(call?.callee)
        const path = bindingPath(callback.params[0], identifier)
        if (
          path &&
          call?.type === 'CallExpression' &&
          call.arguments[0] === callback &&
          callee?.type === 'MemberExpression' &&
          (propertyName(callee) === 'forEach' || propertyName(callee) === 'map')
        ) {
          return { collection: callee.object, path }
        }
        return null
      }
      if (current.parent.type === 'ForOfStatement') {
        const declaration = current.parent.left.declarations?.[0]
        const path = bindingPath(declaration?.id ?? current.parent.left, identifier)
        return path ? { collection: current.parent.right, path } : null
      }
      current = current.parent
    }
    return null
  }

  function remainingAssignedPath(assigned, desired) {
    if (assigned.length > desired.length) return null
    for (let index = 0; index < assigned.length; index += 1) {
      if (
        assigned[index] !== null &&
        desired[index] !== null &&
        String(assigned[index]) !== String(desired[index])
      )
        return null
    }
    return desired.slice(assigned.length)
  }

  return { bindingPath, iterationSource, memberAccess, remainingAssignedPath }
}

module.exports = { createContainerAst }
