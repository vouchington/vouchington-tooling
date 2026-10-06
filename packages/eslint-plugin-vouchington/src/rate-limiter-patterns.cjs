'use strict'

const { patternCandidateDefinitelyDefined } = require('./rate-limiter-pattern-defaults.cjs')
const { patternRestBindingValues } = require('./rate-limiter-pattern-rest.cjs')

function applyOperations(operations, memberPath) {
  const path = [...memberPath]
  for (const operation of operations) {
    if ('property' in operation) {
      path.unshift(operation.property)
      continue
    }
    if (typeof path[0] !== 'number') return null
    path[0] += operation.offset
  }
  return path
}

function patternMemberSources(identifier, memberPath = []) {
  const defaults = []
  const operations = []
  let binding = identifier
  while (true) {
    if (binding.parent?.type === 'AssignmentPattern' && binding.parent.left === binding) {
      defaults.push({ operations: [...operations], source: binding.parent.right })
      binding = binding.parent
    }
    const parent = binding.parent
    if (
      parent?.type === 'RestElement' &&
      parent.argument === binding &&
      parent.parent?.type === 'ArrayPattern'
    ) {
      const offset = parent.parent.elements.indexOf(parent)
      if (offset === -1) return []
      operations.push({ offset })
      binding = parent.parent
      continue
    }
    if (
      parent?.type === 'Property' &&
      parent.value === binding &&
      parent.parent?.type === 'ObjectPattern'
    ) {
      const key = parent.computed
        ? parent.key.type === 'Literal'
          ? parent.key.value
          : null
        : (parent.key.name ?? parent.key.value)
      operations.push({ property: key === null ? null : String(key) })
      binding = parent.parent
      continue
    }
    if (parent?.type === 'ArrayPattern') {
      const index = parent.elements.indexOf(binding)
      if (index === -1) return []
      operations.push({ property: index })
      binding = parent
      continue
    }
    break
  }
  const sources = defaults.toReversed().flatMap((candidate) => {
    const path = applyOperations(candidate.operations, memberPath)
    return path ? [{ path, source: candidate.source }] : []
  })
  const source =
    binding.parent?.type === 'VariableDeclarator' && binding.parent.id === binding
      ? binding.parent.init
      : binding.parent?.type === 'AssignmentExpression' && binding.parent.left === binding
        ? binding.parent.right
        : null
  const path = applyOperations(operations, memberPath)
  if (source && path && operations.length > 0) sources.unshift({ path, source })
  return sources
}

function patternSourceExpression(identifier, memberPath, receiverAtPath, unwrap) {
  const restValues =
    memberPath.length === 0 && unwrap ? patternRestBindingValues(identifier, unwrap) : null
  if (restValues !== null) {
    const candidates = restValues.map((expression) => ({
      expression,
      path: [],
      source: expression,
    }))
    return {
      candidates,
      parent: candidates[0]?.expression.parent,
      range: candidates[0]?.expression.range,
      type: 'PatternDefaultCandidatesExpression',
    }
  }
  const candidates = patternMemberSources(identifier, memberPath).map(({ path, source }) => ({
    expression: receiverAtPath(source, path),
    path,
    source,
  }))
  if (candidates.length === 0) return null
  return {
    candidates,
    parent: candidates[0].expression.parent,
    range: candidates[0].expression.range,
    type: 'PatternDefaultCandidatesExpression',
  }
}

function patternPossibleResults(node, unwrap) {
  if (node?.type !== 'PatternDefaultCandidatesExpression') return null
  const results = []
  for (const candidate of node.candidates) {
    results.push(candidate.expression)
    if (patternCandidateDefinitelyDefined(candidate, unwrap)) break
  }
  return results
}

module.exports = {
  patternMemberSources,
  patternPossibleResults,
  patternRestBindingValues,
  patternSourceExpression,
}
