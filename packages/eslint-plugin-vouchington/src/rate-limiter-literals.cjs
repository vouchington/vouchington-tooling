'use strict'

function propertyKey(property) {
  if (!property.computed && property.key.type === 'Identifier') return property.key.name
  if (property.key.type === 'Literal') return property.key.value
  return null
}

function literalMemberCandidates(value, path, unwrap, resolveSpread) {
  const current = unwrap(value)
  if (path.length === 0) return { candidates: [{ node: current, path: [] }], definite: true }
  const [property, ...remaining] = path
  if (current?.type === 'ObjectExpression') {
    if (property === null || property === undefined) {
      const candidates = current.properties.flatMap((entry) => {
        if (entry.type === 'SpreadElement') {
          return (
            resolveSpread?.(entry.argument, path) ??
            literalMemberCandidates(entry.argument, path, unwrap, resolveSpread)
          ).candidates
        }
        return literalMemberCandidates(entry.value, remaining, unwrap, resolveSpread).candidates
      })
      return { candidates, definite: false }
    }
    const candidates = []
    for (const entry of current.properties.toReversed()) {
      if (entry.type === 'Property' && String(propertyKey(entry)) === String(property)) {
        const explicit = literalMemberCandidates(entry.value, remaining, unwrap, resolveSpread)
        return {
          candidates: [...candidates, ...explicit.candidates],
          definite: true,
        }
      }
      if (entry.type === 'Property' && entry.computed && propertyKey(entry) === null) {
        candidates.push(
          ...literalMemberCandidates(entry.value, remaining, unwrap, resolveSpread).candidates,
        )
      }
      if (entry.type === 'SpreadElement') {
        const spread =
          resolveSpread?.(entry.argument, path) ??
          literalMemberCandidates(entry.argument, path, unwrap, resolveSpread)
        candidates.push(...spread.candidates)
        if (spread.definite) return { candidates, definite: true }
      }
    }
    return { candidates, definite: false }
  }
  if (current?.type === 'ArrayExpression' && (property === null || property === undefined)) {
    return {
      candidates: current.elements.flatMap((element) => {
        if (!element) return []
        return literalMemberCandidates(
          element.type === 'SpreadElement' ? element.argument : element,
          element.type === 'SpreadElement' ? [null, ...remaining] : remaining,
          unwrap,
          resolveSpread,
        ).candidates
      }),
      definite: false,
    }
  }
  if (current?.type === 'ArrayExpression' && /^(0|[1-9]\d*)$/.test(property)) {
    const targetIndex = Number(property)
    const candidates = []
    let minimumIndex = 0
    let hasUnknownLength = false
    for (const element of current.elements) {
      if (!element) {
        minimumIndex += 1
        continue
      }
      if (element.type === 'SpreadElement') {
        if (minimumIndex > targetIndex) continue
        const spreadPath = [hasUnknownLength ? null : targetIndex - minimumIndex, ...remaining]
        const spread =
          resolveSpread?.(element.argument, spreadPath) ??
          literalMemberCandidates(element.argument, spreadPath, unwrap, resolveSpread)
        candidates.push(...spread.candidates)
        if (!hasUnknownLength && spread.definite) {
          return { candidates, definite: true }
        }
        hasUnknownLength = true
        continue
      }
      if (minimumIndex === targetIndex || (hasUnknownLength && minimumIndex <= targetIndex)) {
        const explicit = literalMemberCandidates(element, remaining, unwrap, resolveSpread)
        if (!hasUnknownLength) return explicit
        candidates.push(...explicit.candidates)
      }
      minimumIndex += 1
    }
    return { candidates, definite: false }
  }
  return { candidates: [{ node: current, path }], definite: false }
}

module.exports = { literalMemberCandidates }
