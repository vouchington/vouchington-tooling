'use strict'

const { commonContainer, isUnconditionalWithin } = require('./rate-limiter-writes.cjs')
const { createArrayWrites } = require('./rate-limiter-array-writes.cjs')
const { receiverAtPath } = require('./rate-limiter-extractions.cjs')
const { patternSourceExpression } = require('./rate-limiter-patterns.cjs')

function createContainerWrites({
  context,
  findVariable,
  memberAccess,
  position,
  propertyName,
  remainingAssignedPath,
  unwrap,
}) {
  const { arrayMutation } = createArrayWrites({
    memberAccess,
    position,
    propertyName,
    remainingAssignedPath,
    syntheticWrite,
  })

  function memberAssignment(reference, desiredPath) {
    let member = reference.identifier
    while (member.parent?.type === 'MemberExpression' && member.parent.object === member) {
      member = member.parent
    }
    const assignedAccess = memberAccess(member)
    if (!assignedAccess || assignedAccess.path.length === 0) return []
    const remaining = remainingAssignedPath(assignedAccess.path, desiredPath)
    if (!remaining) return []
    if (
      member.parent?.type === 'AssignmentExpression' &&
      member.parent.left === member &&
      member.parent.operator === '='
    ) {
      return [syntheticWrite(reference, member, member.parent.right, remaining)]
    }
    if (member.parent?.type === 'UnaryExpression' && member.parent.operator === 'delete') {
      return [syntheticWrite(reference, member, null, remaining)]
    }
    return []
  }

  function aliasDefinition(reference, desiredPath) {
    let source = reference.identifier
    while (source.parent?.type === 'MemberExpression' && source.parent.object === source) {
      source = source.parent
    }
    const parent = source.parent
    const aliasIdentifier =
      parent?.type === 'VariableDeclarator' &&
      parent.init === source &&
      parent.id.type === 'Identifier'
        ? parent.id
        : parent?.type === 'AssignmentExpression' &&
            parent.operator === '=' &&
            parent.right === source &&
            parent.left.type === 'Identifier'
          ? parent.left
          : null
    if (!aliasIdentifier) return null
    const access = memberAccess(source)
    const remaining = access && remainingAssignedPath(access.path, desiredPath)
    const variable = findVariable(context, aliasIdentifier)
    return remaining && variable ? { remaining, sourcePath: access.path, variable } : null
  }

  function syntheticWrite(
    reference,
    identifier,
    writeExpr,
    accessPath,
    forceConditional = false,
    rootWrite = false,
  ) {
    return {
      ...reference,
      accessPath,
      forceConditional,
      identifier,
      isWrite: () => true,
      rootWrite,
      writeExpr,
    }
  }

  function lastUnconditionalWriteBetween(variable, path, start, end) {
    const writes = []
    for (const candidate of variable.references) {
      if (candidate.isWrite()) {
        writes.push(syntheticWrite(candidate, candidate.identifier, candidate.writeExpr, path))
      }
      writes.push(...memberAssignment(candidate, path))
    }
    return writes
      .filter((write) => {
        if (
          position(write.identifier) <= position(start) ||
          position(write.identifier) >= position(end)
        ) {
          return false
        }
        const container = commonContainer(write.identifier, end)
        return container && isUnconditionalWithin(write.identifier, container)
      })
      .toSorted((left, right) => position(right.identifier) - position(left.identifier))[0]
  }

  function writesStillShareContainer(variable, alias, source, aliasWrite) {
    const sourceWrite = lastUnconditionalWriteBetween(
      variable,
      alias.sourcePath,
      source,
      aliasWrite.identifier,
    )
    if (
      sourceWrite &&
      !(
        sourceWrite.accessPath.length === 0 &&
        sourceWrite.writeExpr?.type === 'Identifier' &&
        findVariable(context, sourceWrite.writeExpr) === alias.variable
      )
    ) {
      return false
    }
    const aliasWriteBeforeMutation = lastUnconditionalWriteBetween(
      alias.variable,
      alias.remaining,
      source,
      aliasWrite.identifier,
    )
    return (
      !aliasWriteBeforeMutation ||
      (aliasWriteBeforeMutation.writeExpr?.type === 'Identifier' &&
        findVariable(context, aliasWriteBeforeMutation.writeExpr) === variable)
    )
  }

  function mutationWrites(variable, desiredPath, active) {
    const token = JSON.stringify(desiredPath)
    const tokens = active.get(variable) ?? new Set()
    if (tokens.has(token)) return []
    tokens.add(token)
    active.set(variable, tokens)
    const writes = []
    for (const reference of variable.references) {
      writes.push(...memberAssignment(reference, desiredPath))
      writes.push(...arrayMutation(variable, reference, desiredPath))
      const alias = aliasDefinition(reference, desiredPath)
      if (alias) {
        const aliasWrites = mutationWrites(alias.variable, alias.remaining, active)
        for (const aliasWrite of aliasWrites) {
          if (writesStillShareContainer(variable, alias, reference.identifier, aliasWrite)) {
            writes.push({ ...aliasWrite, throughAlias: true })
          }
        }
      }
    }
    tokens.delete(token)
    return writes
  }

  function candidateWrites(variable, path) {
    const directWrites = []
    for (const reference of variable.references) {
      if (reference.isWrite()) {
        const expression = patternSourceExpression(
          reference.identifier,
          path,
          receiverAtPath,
          unwrap,
        )
        directWrites.push(
          syntheticWrite(
            reference,
            reference.identifier,
            expression ?? reference.writeExpr,
            expression ? [] : path,
            false,
            true,
          ),
        )
      }
    }
    return [...directWrites, ...mutationWrites(variable, path, new Map())]
  }

  return { candidateWrites }
}

module.exports = { createContainerWrites }
