'use strict'

function bindingIdentifiers(pattern) {
  if (!pattern) return []
  if (pattern.type === 'Identifier') return [pattern]
  if (pattern.type === 'AssignmentPattern') return bindingIdentifiers(pattern.left)
  if (pattern.type === 'RestElement') return bindingIdentifiers(pattern.argument)
  if (pattern.type === 'ObjectPattern') {
    return pattern.properties.flatMap((property) =>
      bindingIdentifiers(property.type === 'Property' ? property.value : property.argument),
    )
  }
  if (pattern.type === 'ArrayPattern') {
    return pattern.elements.flatMap((element) => bindingIdentifiers(element))
  }
  return []
}

module.exports = { bindingIdentifiers }
