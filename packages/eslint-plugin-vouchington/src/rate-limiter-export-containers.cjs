'use strict'

const { createContainerAst } = require('./rate-limiter-container-ast.cjs')
const { createExportExecutionState } = require('./rate-limiter-export-executions.cjs')
const {
  assignedAlias,
  discoverLiteralPaths,
  insertedArguments,
  isArrayMutator,
} = require('./rate-limiter-export-literal-paths.cjs')
const { literalMemberCandidates } = require('./rate-limiter-literals.cjs')
const { patternMemberSources, patternRestBindingValues } = require('./rate-limiter-patterns.cjs')
const { resolveKnownSpread } = require('./rate-limiter-spreads.cjs')

function createExportContainerTracker({
  context,
  createValueTracker,
  findVariable,
  isCapability,
  isNamespace,
  propertyName,
  unwrap,
}) {
  const { memberAccess } = createContainerAst({ propertyName, unwrap })
  const executionState = createExportExecutionState(context, findVariable, memberAccess, unwrap)
  const { valueMayBeRateLimiter: valueAtPathContainsCapability } = createValueTracker({
    context,
    findVariable,
    isDirectRateLimiter: (node) => isCapability(node) || isNamespace(node),
    propertyName,
    unwrap,
  })
  const inspectLiteral = (node, path, visited = new Set()) =>
    literalMemberCandidates(node, path, unwrap, (spread, spreadPath) =>
      resolveKnownSpread(
        context,
        unwrap(spread),
        spreadPath,
        findVariable,
        (nested, nestedPath, nextVisited) => inspectLiteral(nested, nestedPath, nextVisited),
        visited,
      ),
    )

  function discoverPaths(
    node,
    prefix = [],
    variables = new Set(),
    paths = new Map(),
    collectExecutions = true,
    proofs = [],
    evaluationRoot = node,
  ) {
    const value = unwrap(node)
    if (!value) return paths
    const literalPaths = new Map()
    if (
      discoverLiteralPaths(value, prefix, literalPaths, (child, childPrefix) =>
        discoverPaths(
          child,
          childPrefix,
          variables,
          paths,
          collectExecutions,
          proofs,
          evaluationRoot,
        ),
      )
    ) {
      for (const path of literalPaths.values()) proofs.push({ path, root: evaluationRoot })
      return paths
    }
    if (value.type !== 'Identifier') return paths
    const variable = findVariable(context, value)
    if (!variable || variables.has(variable)) return paths
    const nextVariables = new Set(variables)
    nextVariables.add(variable)
    for (const reference of variable.references) {
      executionState.add(reference, collectExecutions)
      if (reference.isWrite()) {
        const restValues = patternRestBindingValues(reference.identifier, unwrap)
        if (restValues !== null) {
          restValues.forEach((restValue) =>
            discoverPaths(
              restValue,
              prefix,
              nextVariables,
              paths,
              collectExecutions,
              proofs,
              restValue,
            ),
          )
        } else {
          const extracted = patternMemberSources(reference.identifier)
          for (const candidate of extracted) {
            for (const resolved of inspectLiteral(candidate.source, candidate.path).candidates) {
              if (resolved.path.length === 0) {
                discoverPaths(
                  resolved.node,
                  prefix,
                  nextVariables,
                  paths,
                  collectExecutions,
                  proofs,
                  evaluationRoot,
                )
              } else {
                const path = [...prefix, ...resolved.path]
                paths.set(JSON.stringify(path), path)
                proofs.push({ path, root: evaluationRoot })
              }
            }
          }
          if (extracted.length === 0) {
            discoverPaths(
              reference.writeExpr,
              prefix,
              nextVariables,
              paths,
              collectExecutions,
              proofs,
              evaluationRoot,
            )
          }
        }
      }
      let member = reference.identifier
      while (member.parent?.type === 'MemberExpression' && member.parent.object === member) {
        member = member.parent
      }
      const access = memberAccess(member)
      if (!access) continue
      if (member.parent?.type === 'AssignmentExpression' && member.parent.left === member) {
        const path = [...prefix, ...access.path]
        paths.set(JSON.stringify(path), path)
        proofs.push({ path, root: evaluationRoot })
        discoverPaths(
          member.parent.right,
          path,
          nextVariables,
          paths,
          collectExecutions,
          proofs,
          evaluationRoot,
        )
      }
      const call = member.parent
      const method = propertyName(member)
      if (call?.type === 'CallExpression' && call.callee === member && isArrayMutator(method)) {
        const path = [...prefix, ...access.path.slice(0, -1), null]
        paths.set(JSON.stringify(path), path)
        proofs.push({ path, root: evaluationRoot })
        insertedArguments(method, call).forEach((argument) =>
          discoverPaths(
            argument,
            path,
            nextVariables,
            paths,
            collectExecutions,
            proofs,
            evaluationRoot,
          ),
        )
      }
      const parent = member.parent
      const alias = assignedAlias(member)
      if (alias) {
        const aliasAttached =
          executionState.aliasRemainsAttached(variable, parent) &&
          executionState.aliasPointsToPathAtModuleEnd(variable, access.path, alias, parent)
        discoverPaths(
          alias,
          aliasAttached ? [] : [...prefix, ...access.path],
          nextVariables,
          paths,
          collectExecutions && aliasAttached,
          proofs,
          collectExecutions && aliasAttached ? alias : evaluationRoot,
        )
      }
    }
    return paths
  }

  return (node) => {
    const proofs = []
    discoverPaths(node, [], new Set(), new Map(), true, proofs)
    return executionState
      .receivers()
      .some(
        (receiver) =>
          valueAtPathContainsCapability(node, [], receiver) ||
          proofs.some(({ path, root }) => valueAtPathContainsCapability(root, path, receiver)),
      )
  }
}

module.exports = { createExportContainerTracker }
