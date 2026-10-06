'use strict'

const { executionFunction } = require('./rate-limiter-execution.cjs')
const { literalMemberCandidates } = require('./rate-limiter-literals.cjs')
const { mayReachRateLimiter, position } = require('./rate-limiter-writes.cjs')

const LOGICAL_ASSIGNMENTS = new Set(['&&=', '??=', '||='])

function createExportExecutionState(context, findVariable, memberAccess, unwrap) {
  const executions = new Set()
  const program = context.sourceCode.ast
  const end = program.range?.[1] ?? program.end
  const moduleEnd = {
    name: '__module_end__',
    parent: program,
    range: [end, end],
    type: 'Identifier',
  }
  function expressionPointsToPath(expression, root, path, cutoff, visited) {
    const value = unwrap(expression)
    if (value?.type === 'Identifier') {
      return variablePointsToPath(findVariable(context, value), root, path, cutoff, visited)
    }
    if (value?.type !== 'MemberExpression') return false
    const access = memberAccess(value)
    if (!access || access.path.length > path.length) return false
    const prefixLength = path.length - access.path.length
    if (
      !access.path.every(
        (property, index) => String(property) === String(path[prefixLength + index]),
      )
    )
      return false
    return variablePointsToPath(
      findVariable(context, access.root),
      root,
      path.slice(0, prefixLength),
      cutoff,
      visited,
    )
  }
  function variablePointsToPath(candidate, root, path, cutoff, visited = new Set()) {
    if (!candidate) return false
    if (candidate === root) return path.length === 0
    if (visited.has(candidate)) return false
    const nextVisited = new Set(visited)
    nextVisited.add(candidate)
    const writes = candidate.references.filter(
      (write) =>
        write.isWrite() &&
        executionFunction(write.identifier) === null &&
        position(write.identifier) < position(cutoff),
    )
    return mayReachRateLimiter(writes, cutoff, (expression, write) => {
      return expressionPointsToPath(expression, root, path, write.identifier, nextVisited)
    })
  }
  function isPathPrefix(prefix, path) {
    return (
      prefix.length <= path.length &&
      prefix.every((property, index) => String(property) === String(path[index]))
    )
  }
  function memberPathChanges(root, path, capture) {
    return root.references.flatMap((reference) => {
      let member = reference.identifier
      while (member.parent?.type === 'MemberExpression' && member.parent.object === member) {
        member = member.parent
      }
      const access = memberAccess(member)
      if (
        !access ||
        !isPathPrefix(access.path, path) ||
        executionFunction(member) !== null ||
        position(member) <= position(capture)
      )
        return []
      if (member.parent?.type === 'AssignmentExpression' && member.parent.left === member) {
        return [
          {
            accessPath: access.path,
            forceConditional: LOGICAL_ASSIGNMENTS.has(member.parent.operator),
            identifier: member,
            identityFromRight: member.parent.operator === '=',
            writeExpr: member.parent.right,
          },
        ]
      }
      if (member.parent?.type === 'UpdateExpression' && member.parent.argument === member) {
        return [{ accessPath: access.path, identifier: member, writeExpr: null }]
      }
      return member.parent?.type === 'UnaryExpression' &&
        member.parent.operator === 'delete' &&
        member.parent.argument === member
        ? [{ accessPath: access.path, identifier: member, writeExpr: null }]
        : []
    })
  }
  function writeRestoresCapturedPath(expression, writePath, root, path, cutoff) {
    if (expressionPointsToPath(expression, root, writePath, cutoff, new Set())) return true
    const suffix = path.slice(writePath.length)
    const resolved = literalMemberCandidates(expression, suffix, unwrap)
    return resolved.candidates.some(
      (candidate) =>
        candidate.path.length === 0 &&
        expressionPointsToPath(candidate.node, root, path, cutoff, new Set()),
    )
  }
  return {
    add(reference, enabled) {
      const execution = executionFunction(reference.identifier)
      if (execution && enabled) executions.add(execution)
    },
    aliasRemainsAttached(variable, capture) {
      const rootWrites = variable.references.flatMap((write) => {
        if (
          !write.isWrite() ||
          executionFunction(write.identifier) !== null ||
          position(write.identifier) <= position(capture)
        )
          return []
        const assignment = write.identifier.parent
        return [
          {
            ...write,
            forceConditional:
              assignment?.type === 'AssignmentExpression' &&
              LOGICAL_ASSIGNMENTS.has(assignment.operator),
            identityFromRight:
              assignment?.type !== 'AssignmentExpression' || assignment.operator === '=',
          },
        ]
      })
      if (rootWrites.length === 0) return true
      rootWrites.unshift({
        identifier: capture,
        writeExpr: variable.identifiers[0],
      })
      const identifierReferencesRoot = (identifier, cutoff) => {
        const value = unwrap(identifier)
        if (value?.type !== 'Identifier') return false
        return variablePointsToPath(findVariable(context, value), variable, [], cutoff)
      }
      const attached = mayReachRateLimiter(rootWrites, moduleEnd, (expression, write) => {
        return (
          write.identityFromRight !== false &&
          identifierReferencesRoot(expression, write.identifier)
        )
      })
      return attached
    },
    aliasPointsToPathAtModuleEnd(variable, path, alias, capture) {
      if (!variablePointsToPath(findVariable(context, alias), variable, path, moduleEnd))
        return false
      const writes = memberPathChanges(variable, path, capture)
      if (writes.length === 0) return true
      writes.unshift({ attached: true, identifier: capture })
      return mayReachRateLimiter(writes, moduleEnd, (expression, write) => {
        return (
          write.attached ||
          (write.identityFromRight !== false &&
            writeRestoresCapturedPath(
              expression,
              write.accessPath,
              variable,
              path,
              write.identifier,
            ))
        )
      })
    },
    receivers() {
      return [
        moduleEnd,
        ...[...executions].map((execution) => {
          const executionEnd = execution.range?.[1] ?? execution.end
          return {
            name: '__execution_end__',
            parent: execution.body,
            range: [executionEnd, executionEnd],
            type: 'Identifier',
          }
        }),
      ]
    },
  }
}

module.exports = { createExportExecutionState }
