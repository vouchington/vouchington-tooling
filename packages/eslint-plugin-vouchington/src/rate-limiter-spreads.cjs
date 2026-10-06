'use strict'

const { commonContainer, isUnconditionalWithin } = require('./rate-limiter-writes.cjs')

function position(node) {
  return node.range?.[0] ?? node.start ?? -1
}

function resolveKnownSpread(
  context,
  source,
  path,
  findVariable,
  inspectLiteral,
  visited = new Set(),
) {
  if (source?.type !== 'Identifier') return null
  const variable = findVariable(context, source)
  if (!variable || visited.has(variable)) return null
  const nextVisited = new Set(visited)
  nextVisited.add(variable)
  const writes = variable.references
    .filter((reference) => reference.isWrite() && position(reference.identifier) < position(source))
    .toSorted((left, right) => position(left.identifier) - position(right.identifier))
  let latestUnconditional = -1
  for (const [index, write] of writes.entries()) {
    const container = commonContainer(write.identifier, source)
    if (container && isUnconditionalWithin(write.identifier, container)) {
      latestUnconditional = index
    }
  }
  if (latestUnconditional < 0 || writes.length !== latestUnconditional + 1) {
    return null
  }
  return inspectLiteral(writes[latestUnconditional].writeExpr, path, nextVisited)
}

module.exports = { resolveKnownSpread }
