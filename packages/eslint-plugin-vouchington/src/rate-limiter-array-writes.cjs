'use strict'

const { createArrayLength } = require('./rate-limiter-array-length.cjs')

function createArrayWrites({
  memberAccess,
  position,
  propertyName,
  remainingAssignedPath,
  syntheticWrite,
}) {
  const { arrayLengthBefore, normalizedSpliceStart, spliceDeleteCount } = createArrayLength({
    position,
    propertyName,
  })

  function insertedValues(arguments_) {
    const values = []
    for (const argument of arguments_) {
      if (argument.type !== 'SpreadElement') {
        values.push(argument)
      } else if (argument.argument.type === 'ArrayExpression') {
        values.push(...argument.argument.elements.filter(Boolean))
      } else {
        return null
      }
    }
    return values
  }

  function relocatedElementWrite({
    call,
    currentLength,
    desiredIndex,
    insertedCount,
    method,
    reference,
    remaining,
  }) {
    if (desiredIndex === null) return []
    if (insertedCount === null && (method === 'unshift' || method === 'splice')) {
      return [
        syntheticWrite(reference, call, reference.identifier, [null, ...remaining.slice(1)], true),
      ]
    }
    let oldIndex = null
    if (method === 'unshift' && insertedCount !== null && desiredIndex >= insertedCount) {
      oldIndex = desiredIndex - insertedCount
    } else if (method === 'shift') {
      oldIndex = desiredIndex + 1
    } else if (method === 'splice' && currentLength !== null) {
      const start = normalizedSpliceStart(call, currentLength)
      const deleted = start === null ? null : spliceDeleteCount(call, start, currentLength)
      if (
        start !== null &&
        deleted !== null &&
        desiredIndex >= start + insertedCount &&
        desiredIndex < currentLength - deleted + insertedCount
      ) {
        oldIndex = desiredIndex - insertedCount + deleted
      }
    }
    return oldIndex === null
      ? []
      : [syntheticWrite(reference, call, reference.identifier, [oldIndex, ...remaining.slice(1)])]
  }

  function arrayMutation(variable, reference, desiredPath) {
    let callee = reference.identifier
    while (callee.parent?.type === 'MemberExpression' && callee.parent.object === callee) {
      callee = callee.parent
    }
    const call = callee.parent
    const access = memberAccess(callee)
    if (call?.type !== 'CallExpression' || call.callee !== callee || !access) return []
    const method = propertyName(callee)
    const remaining = remainingAssignedPath(access.path.slice(0, -1), desiredPath)
    if (!remaining || remaining.length === 0) return []
    const insertedArguments =
      method === 'push' || method === 'unshift'
        ? call.arguments
        : method === 'splice'
          ? call.arguments.slice(2)
          : method === 'fill'
            ? call.arguments.slice(0, 1)
            : []
    const inserted = insertedValues(insertedArguments)
    const desiredIndex = typeof remaining[0] === 'number' ? remaining[0] : null
    const currentLength = arrayLengthBefore(variable, call)
    const relocatedWrites = relocatedElementWrite({
      call,
      currentLength,
      desiredIndex,
      insertedCount: inserted?.length ?? null,
      method,
      reference,
      remaining,
    })
    if (!inserted) {
      return [
        ...relocatedWrites,
        ...insertedArguments.map((argument) =>
          syntheticWrite(
            reference,
            call,
            argument.type === 'SpreadElement' ? argument.argument : argument,
            [null, ...remaining.slice(1)],
            true,
          ),
        ),
      ]
    }
    const spliceStart = currentLength === null ? null : normalizedSpliceStart(call, currentLength)
    const firstInsertedIndex =
      method === 'unshift'
        ? 0
        : method === 'push'
          ? currentLength
          : method === 'splice' && typeof spliceStart === 'number'
            ? spliceStart
            : null
    return [
      ...relocatedWrites,
      ...inserted.flatMap((argument, index) => {
        if (
          desiredIndex !== null &&
          firstInsertedIndex !== null &&
          desiredIndex !== firstInsertedIndex + index
        ) {
          return []
        }
        const isExactKnownInsertion = desiredIndex !== null && firstInsertedIndex !== null
        return [
          syntheticWrite(reference, call, argument, remaining.slice(1), !isExactKnownInsertion),
        ]
      }),
    ]
  }

  return { arrayMutation }
}

module.exports = { createArrayWrites }
