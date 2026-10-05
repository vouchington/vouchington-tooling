import type { AmbiguousAttributionFact } from './response-contract-lenient.mts'

export function sortAttributionFacts(
  facts: readonly AmbiguousAttributionFact[],
): AmbiguousAttributionFact[] {
  return [...facts].toSorted((left, right) => {
    const first = parseSourceLocation(left.sourceLocation)
    const second = parseSourceLocation(right.sourceLocation)
    if (first.path !== second.path) return first.path < second.path ? -1 : 1
    return first.line - second.line || first.column - second.column
  })
}

function parseSourceLocation(location: string) {
  const columnSeparator = location.lastIndexOf(':')
  const lineSeparator = location.lastIndexOf(':', columnSeparator - 1)
  return {
    path: location.slice(0, lineSeparator),
    line: Number(location.slice(lineSeparator + 1, columnSeparator)),
    column: Number(location.slice(columnSeparator + 1)),
  }
}
