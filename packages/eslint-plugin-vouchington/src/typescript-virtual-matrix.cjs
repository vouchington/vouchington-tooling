'use strict'

function importDefinition(variable, importedName, source, specifierType = 'ImportSpecifier') {
  return variable?.defs?.find((definition) => {
    const specifier = definition.node
    const declaration = definition.parent || specifier?.parent
    return (
      definition.type === 'ImportBinding' &&
      specifier?.type === specifierType &&
      specifier.importKind !== 'type' &&
      declaration?.type === 'ImportDeclaration' &&
      declaration.importKind !== 'type' &&
      (specifierType !== 'ImportSpecifier' ||
        (specifier.imported?.name ?? specifier.imported?.value) === importedName) &&
      source(declaration.source?.value)
    )
  })
}

function isImportMeta(node, unwrap) {
  const value = unwrap(node)
  return (
    value?.type === 'MetaProperty' &&
    value.meta?.name === 'import' &&
    value.property?.name === 'meta'
  )
}

function createVirtualMatrixTracker({
  context,
  createValueTracker,
  findVariable,
  propertyName,
  unwrap,
  options,
}) {
  if (!options)
    return {
      isBuilderValue: () => false,
      isNamespaceValue: () => false,
      isInvalidBuilderCall: () => false,
      isVirtualProgramSource: () => false,
    }
  const checksLifecycle = !options.allowLifecycleFiles.includes(options.currentFile)
  const moduleName = options.moduleBasename
  const matchesVirtualSource = (source) =>
    typeof source === 'string' &&
    (source === moduleName ||
      source === `${moduleName}.mts` ||
      source.endsWith(`/${moduleName}`) ||
      source.endsWith(`/${moduleName}.mts`))
  const isVirtualNamespaceReference = (node) => {
    const value = unwrap(node)
    return (
      value?.type === 'Identifier' &&
      Boolean(
        importDefinition(
          findVariable(context, value),
          null,
          (source) => matchesVirtualSource(source),
          'ImportNamespaceSpecifier',
        ),
      )
    )
  }
  const { valueMayBeRateLimiter: isNamespaceValue } = createValueTracker({
    context,
    findVariable,
    isDirectRateLimiter: isVirtualNamespaceReference,
    propertyName,
    unwrap,
  })
  const isBuilderReference = (node) => {
    const value = unwrap(node)
    return (
      (value?.type === 'Identifier' &&
        Boolean(
          importDefinition(findVariable(context, value), options.builder, (source) =>
            matchesVirtualSource(source),
          ),
        )) ||
      (value?.type === 'MemberExpression' &&
        propertyName(value) === options.builder &&
        isNamespaceValue(value.object))
    )
  }
  const { valueMayBeRateLimiter: isBuilderValue } = createValueTracker({
    context,
    findVariable,
    isDirectRateLimiter: isBuilderReference,
    propertyName,
    unwrap,
  })

  const isVitestNamespaceReference = (node) => {
    const value = unwrap(node)
    return (
      value?.type === 'Identifier' &&
      Boolean(
        importDefinition(
          findVariable(context, value),
          null,
          (source) => source === options.testModule,
          'ImportNamespaceSpecifier',
        ),
      )
    )
  }
  const { valueMayBeRateLimiter: isVitestNamespaceValue } = createValueTracker({
    context,
    findVariable,
    isDirectRateLimiter: isVitestNamespaceReference,
    propertyName,
    unwrap,
  })
  function importedBeforeAll(callee) {
    const value = unwrap(callee)
    return Boolean(
      (value?.type === 'Identifier' &&
        importDefinition(
          findVariable(context, value),
          options.testHook,
          (source) => source === options.testModule,
        )) ||
      (value?.type === 'MemberExpression' &&
        propertyName(value) === options.testHook &&
        isVitestNamespaceValue(value.object)),
    )
  }

  function directBeforeAllCallback(node) {
    let current = node.parent
    while (current) {
      if (
        current.type === 'ArrowFunctionExpression' ||
        current.type === 'FunctionExpression' ||
        current.type === 'FunctionDeclaration'
      ) {
        const call = current.parent
        const callee = unwrap(call?.callee)
        return Boolean(
          (current.type === 'ArrowFunctionExpression' || current.type === 'FunctionExpression') &&
          call?.type === 'CallExpression' &&
          call.arguments.includes(current) &&
          importedBeforeAll(callee),
        )
      }
      current = current.parent
    }
    return false
  }

  function builderInvocation(call) {
    const callee = unwrap(call.callee)
    if (isBuilderValue(callee)) return { argument: call.arguments[0] }
    if (
      callee?.type === 'MemberExpression' &&
      propertyName(callee) === 'call' &&
      isBuilderValue(callee.object)
    ) {
      return { argument: call.arguments[1] }
    }
    if (
      callee?.type === 'MemberExpression' &&
      propertyName(callee) === 'apply' &&
      callee.object.type === 'Identifier' &&
      callee.object.name === 'Reflect' &&
      !findVariable(context, callee.object)?.defs?.length &&
      isBuilderValue(call.arguments[0])
    ) {
      return { argument: null }
    }
    return null
  }

  return {
    isBuilderValue,
    isNamespaceValue,
    isInvalidBuilderCall(call) {
      if (!checksLifecycle) return false
      const invocation = builderInvocation(call)
      return Boolean(
        invocation &&
        (!isImportMeta(invocation.argument, unwrap) || !directBeforeAllCallback(call)),
      )
    },
    isVirtualProgramSource(source) {
      return matchesVirtualSource(source)
    },
  }
}

module.exports = { createVirtualMatrixTracker }
