'use strict'

const { commonContainer, isUnconditionalWithin } = require('./rate-limiter-writes.cjs')

function createArrayLength({ position, propertyName }) {
  function insertedCount(arguments_) {
    let count = 0
    for (const argument of arguments_) {
      if (argument.type !== 'SpreadElement') {
        count += 1
      } else if (argument.argument.type === 'ArrayExpression') {
        count += argument.argument.elements.filter(Boolean).length
      } else {
        return null
      }
    }
    return count
  }

  function normalizedSpliceStart(call, length) {
    const raw = call.arguments[0]?.type === 'Literal' ? call.arguments[0].value : 0
    if (typeof raw !== 'number') return null
    return raw < 0 ? Math.max(length + raw, 0) : Math.min(raw, length)
  }

  function spliceDeleteCount(call, start, length) {
    if (call.arguments.length < 2) return length - start
    const raw = call.arguments[1]
    if (raw?.type !== 'Literal' || typeof raw.value !== 'number') return null
    return Math.min(Math.max(raw.value, 0), length - start)
  }

  function mutationCall(reference) {
    let member = reference.identifier
    while (member.parent?.type === 'MemberExpression' && member.parent.object === member) {
      member = member.parent
    }
    const call = member.parent
    if (call?.type !== 'CallExpression' || call.callee !== member) return null
    const method = propertyName(member)
    return ['fill', 'pop', 'push', 'shift', 'splice', 'unshift'].includes(method)
      ? { call, method }
      : null
  }

  function arrayLengthBefore(variable, before) {
    const initializations = variable.references.filter(
      (reference) =>
        reference.isWrite() &&
        reference.writeExpr?.type === 'ArrayExpression' &&
        position(reference.identifier) < position(before),
    )
    const otherWrites = variable.references.filter(
      (reference) =>
        reference.isWrite() &&
        reference.writeExpr?.type !== 'ArrayExpression' &&
        position(reference.identifier) < position(before),
    )
    if (initializations.length !== 1 || otherWrites.length > 0) return null
    const initialization = initializations[0]
    let length = initialization.writeExpr.elements.length
    const seen = new Set()
    const mutations = []
    for (const reference of variable.references) {
      let member = reference.identifier
      while (member.parent?.type === 'MemberExpression' && member.parent.object === member) {
        member = member.parent
      }
      if (
        position(member) > position(initialization.identifier) &&
        position(member) < position(before) &&
        member.parent?.type === 'AssignmentExpression' &&
        member.parent.left === member
      ) {
        return null
      }
      const mutation = mutationCall(reference)
      if (
        !mutation ||
        seen.has(mutation.call) ||
        position(mutation.call) <= position(initialization.identifier) ||
        position(mutation.call) >= position(before)
      ) {
        continue
      }
      const container = commonContainer(mutation.call, before)
      if (!container || !isUnconditionalWithin(mutation.call, container)) return null
      seen.add(mutation.call)
      mutations.push(mutation)
    }
    for (const { call, method } of mutations.toSorted(
      (left, right) => position(left.call) - position(right.call),
    )) {
      if (method === 'pop' || method === 'shift') {
        length = Math.max(length - 1, 0)
      } else if (method === 'push' || method === 'unshift') {
        const count = insertedCount(call.arguments)
        if (count === null) return null
        length += count
      } else if (method === 'splice') {
        const start = normalizedSpliceStart(call, length)
        const deleted = start === null ? null : spliceDeleteCount(call, start, length)
        const inserted = insertedCount(call.arguments.slice(2))
        if (deleted === null || inserted === null) return null
        length += inserted - deleted
      }
    }
    return length
  }

  return { arrayLengthBefore, normalizedSpliceStart, spliceDeleteCount }
}

module.exports = { createArrayLength }
