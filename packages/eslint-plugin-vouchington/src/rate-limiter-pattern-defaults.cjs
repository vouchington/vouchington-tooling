'use strict'

const { literalMemberCandidates } = require('./rate-limiter-literals.cjs')

const GUARANTEED_TYPES = new Set([
  'ArrayExpression',
  'ArrowFunctionExpression',
  'ClassExpression',
  'FunctionExpression',
  'Literal',
  'NewExpression',
  'ObjectExpression',
  'TemplateLiteral',
])

function nodesDefinitelyDefined(nodes, unwrap) {
  return nodes.length > 0 && nodes.every((node) => GUARANTEED_TYPES.has(unwrap(node)?.type))
}

function patternCandidateDefinitelyDefined({ path, source }, unwrap) {
  const resolved = literalMemberCandidates(source, path, unwrap)
  return (
    resolved.definite &&
    resolved.candidates.every(
      (candidate) =>
        candidate.path.length === 0 && nodesDefinitelyDefined([candidate.node], unwrap),
    )
  )
}

module.exports = { nodesDefinitelyDefined, patternCandidateDefinitelyDefined }
