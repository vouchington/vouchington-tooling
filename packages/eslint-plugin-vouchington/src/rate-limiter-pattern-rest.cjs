'use strict'

const { literalMemberCandidates } = require('./rate-limiter-literals.cjs')
const { nodesDefinitelyDefined } = require('./rate-limiter-pattern-defaults.cjs')

function applyRestOperation(nodes, operation, unwrap) {
  let definite = true
  const values = []
  for (const node of nodes) {
    const value = unwrap(node)
    if ('property' in operation) {
      const resolved = literalMemberCandidates(value, [operation.property], unwrap)
      definite &&= resolved.definite
      values.push(
        ...resolved.candidates.flatMap((candidate) =>
          candidate.path.length === 0 ? [candidate.node] : [],
        ),
      )
    } else if ('arrayRest' in operation && value?.type === 'ArrayExpression') {
      values.push({ ...value, elements: value.elements.slice(operation.arrayRest) })
    } else if ('objectRest' in operation && value?.type === 'ObjectExpression') {
      const excluded = new Set(operation.objectRest.map(String))
      values.push({
        ...value,
        properties: value.properties.filter(
          (property) =>
            property.type === 'SpreadElement' ||
            !excluded.has(
              String(
                property.computed ? property.key.value : (property.key.name ?? property.key.value),
              ),
            ),
        ),
      })
    }
  }
  return { definite, values }
}

function patternRestBindingValues(identifier, unwrap) {
  const operations = []
  const defaults = []
  let binding = identifier
  while (binding?.parent) {
    if (binding.parent.type === 'AssignmentPattern' && binding.parent.left === binding) {
      defaults.push({ operations: [...operations], source: binding.parent.right })
      binding = binding.parent
      continue
    }
    const parent = binding.parent
    if (parent.type === 'RestElement' && parent.argument === binding) {
      const pattern = parent.parent
      if (pattern?.type === 'ArrayPattern') {
        operations.push({ arrayRest: pattern.elements.indexOf(parent) })
      } else if (pattern?.type === 'ObjectPattern') {
        operations.push({
          objectRest: pattern.properties.flatMap((property) =>
            property.type === 'Property'
              ? [
                  property.computed
                    ? property.key.type === 'Literal'
                      ? property.key.value
                      : null
                    : (property.key.name ?? property.key.value),
                ]
              : [],
          ),
        })
      } else return null
      binding = pattern
      continue
    }
    if (parent.type === 'Property' && parent.value === binding) {
      operations.push({
        property: parent.computed
          ? parent.key.type === 'Literal'
            ? parent.key.value
            : null
          : (parent.key.name ?? parent.key.value),
      })
      binding = parent.parent
      continue
    }
    if (parent.type === 'ArrayPattern') {
      operations.push({ property: parent.elements.indexOf(binding) })
      binding = parent
      continue
    }
    break
  }
  const source =
    binding.parent?.type === 'VariableDeclarator'
      ? binding.parent.init
      : binding.parent?.type === 'AssignmentExpression'
        ? binding.parent.right
        : null
  if (
    !source ||
    !operations.some((operation) => 'arrayRest' in operation || 'objectRest' in operation)
  )
    return null
  const transform = (candidate) => {
    let definite = true
    let values = [candidate.source]
    for (const operation of candidate.operations.toReversed()) {
      const definedBeforeOperation = definite && nodesDefinitelyDefined(values, unwrap)
      const transformed = applyRestOperation(values, operation, unwrap)
      definite &&= transformed.definite
      values = transformed.values
      if (values.length === 0) {
        if (definedBeforeOperation && ('arrayRest' in operation || 'objectRest' in operation)) {
          return { definite: true, values }
        }
        definite = false
      }
    }
    return { definite: definite && nodesDefinitelyDefined(values, unwrap), values }
  }
  const values = []
  for (const candidate of [{ operations, source }, ...defaults.toReversed()]) {
    const transformed = transform(candidate)
    values.push(...transformed.values)
    if (transformed.definite) break
  }
  return values
}

module.exports = { patternRestBindingValues }
