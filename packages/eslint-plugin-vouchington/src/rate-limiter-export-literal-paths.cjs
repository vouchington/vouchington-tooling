'use strict'

const ARRAY_MUTATORS = new Set(['fill', 'push', 'splice', 'unshift'])

function propertyKey(property) {
  if (!property.computed && property.key.type === 'Identifier') return property.key.name
  if (property.key.type === 'Literal') return property.key.value
  return null
}

function discoverLiteralPaths(value, prefix, paths, recurse) {
  if (value.type === 'ObjectExpression') {
    for (const property of value.properties) {
      if (property.type === 'SpreadElement') {
        if (property.argument.type === 'Identifier') recurse(property.argument, prefix)
        else paths.set(JSON.stringify([...prefix, null]), [...prefix, null])
        continue
      }
      const path = [...prefix, propertyKey(property)]
      paths.set(JSON.stringify(path), path)
      recurse(property.value, path)
    }
    return true
  }
  if (value.type === 'ArrayExpression') {
    value.elements.forEach((element, index) => {
      if (!element) return
      const path = [...prefix, element.type === 'SpreadElement' ? null : index]
      paths.set(JSON.stringify(path), path)
      recurse(element.type === 'SpreadElement' ? element.argument : element, path)
    })
    return true
  }
  return false
}

function assignedAlias(member) {
  const parent = member.parent
  if (
    parent?.type === 'VariableDeclarator' &&
    parent.init === member &&
    parent.id.type === 'Identifier'
  )
    return parent.id
  if (
    parent?.type === 'AssignmentExpression' &&
    parent.right === member &&
    parent.left.type === 'Identifier'
  )
    return parent.left
  return null
}

function insertedArguments(method, call) {
  if (method === 'splice') return call.arguments.slice(2)
  if (method === 'fill') return call.arguments.slice(0, 1)
  return call.arguments
}

module.exports = {
  assignedAlias,
  discoverLiteralPaths,
  insertedArguments,
  isArrayMutator: (method) => ARRAY_MUTATORS.has(method),
}
