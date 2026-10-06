'use strict'

function executionFunction(node) {
  let current = node?.parent
  while (current) {
    if (
      current.type === 'ArrowFunctionExpression' ||
      current.type === 'FunctionExpression' ||
      current.type === 'FunctionDeclaration'
    ) {
      return current
    }
    current = current.parent
  }
  return null
}

module.exports = { executionFunction }
