'use strict'

const { patternPossibleResults } = require('./rate-limiter-patterns.cjs')

function possibleResults(node, unwrap) {
  const value = unwrap(node)
  const patternResults = patternPossibleResults(value, unwrap)
  if (patternResults) return patternResults.flatMap((result) => possibleResults(result, unwrap))
  if (value?.type === 'ConditionalExpression') {
    return [
      ...possibleResults(value.consequent, unwrap),
      ...possibleResults(value.alternate, unwrap),
    ]
  }
  if (value?.type === 'LogicalExpression') {
    return [...possibleResults(value.left, unwrap), ...possibleResults(value.right, unwrap)]
  }
  if (value?.type === 'SequenceExpression') {
    return possibleResults(value.expressions.at(-1), unwrap)
  }
  return value ? [value] : []
}

module.exports = { possibleResults }
