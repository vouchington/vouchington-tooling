'use strict'
const { bindingIdentifiers } = require('./binding-identifiers.cjs')
const { createRequireProvenance } = require('./create-require-provenance.cjs')
const { createExportContainerTracker } = require('./rate-limiter-export-containers.cjs')
const { createFactoryInvocation } = require('./typescript-program-invoked-factory.cjs')
const { createValueTracker } = require('./rate-limiter-values.cjs')
const { createVirtualMatrixTracker } = require('./typescript-virtual-matrix.cjs')
const MESSAGE = 'Construct configured compiler factories only in an owner file.'
function importDefinition(variable, specifierTypes, MODULES) {
  return variable?.defs?.find((definition) => {
    const specifier = definition.node
    const declaration = definition.parent || specifier?.parent
    return (
      definition.type === 'ImportBinding' &&
      specifierTypes.has(specifier?.type) &&
      specifier.importKind !== 'type' &&
      declaration?.type === 'ImportDeclaration' &&
      declaration.importKind !== 'type' &&
      MODULES.has(declaration.source?.value)
    )
  })
}
function awaitedImport(node, unwrap, MODULES) {
  let value = unwrap(node)
  if (value?.type === 'AwaitExpression') value = unwrap(value.argument)
  return value?.type === 'ImportExpression' && MODULES.has(value.source?.value)
}
function createTypescriptProgramConstructionRule({ findVariable, propertyName, unwrap, options }) {
  const FACTORIES = new Set(options.factories)
  const MODULES = new Set(options.modules)
  return {
    meta: {
      type: 'problem',
      docs: {
        description: 'keep configured compiler construction in its owner files',
      },
      schema: [],
      messages: { constructionOwner: MESSAGE },
    },
    create(context) {
      const sourceText = context.sourceCode.text
      if (
        ![...MODULES].some((moduleName) => sourceText.includes(moduleName)) &&
        (!options.virtualMatrix || !sourceText.includes(options.virtualMatrix.moduleBasename))
      )
        return {}
      const isExactRequireCall = createRequireProvenance({ findVariable, propertyName, unwrap })
      const factoryInvocation = createFactoryInvocation({
        context,
        findVariable,
        propertyName,
        unwrap,
      })
      const isNamespaceReference = (node) => {
        const value = unwrap(node)
        if (awaitedImport(value, unwrap, MODULES)) return true
        if ([...MODULES].some((moduleName) => isExactRequireCall(context, value, moduleName))) {
          return true
        }
        return (
          value?.type === 'Identifier' &&
          Boolean(
            importDefinition(
              findVariable(context, value),
              new Set(['ImportDefaultSpecifier', 'ImportNamespaceSpecifier']),
              MODULES,
            ),
          )
        )
      }
      const { valueMayBeRateLimiter: isNamespaceValue } = createValueTracker({
        context,
        findVariable,
        isDirectRateLimiter: isNamespaceReference,
        propertyName,
        unwrap,
      })
      let isFactoryBinderValue = () => false
      let isFactoryValue = () => false
      const isFactoryReference = (node) => {
        const value = unwrap(node)
        if (factoryInvocation.isFactoryResult(value, isFactoryValue, isFactoryBinderValue))
          return true
        if (value?.type === 'Identifier') {
          const definition = importDefinition(
            findVariable(context, value),
            new Set(['ImportSpecifier']),
            MODULES,
          )
          const imported = definition?.node.imported
          return FACTORIES.has(imported?.name ?? imported?.value)
        }
        return (
          value?.type === 'MemberExpression' &&
          FACTORIES.has(String(propertyName(value))) &&
          isNamespaceValue(value.object)
        )
      }
      ;({ valueMayBeRateLimiter: isFactoryValue } = createValueTracker({
        context,
        findVariable,
        isDirectRateLimiter: isFactoryReference,
        isDirectRateLimiterAtPath: (node, path) =>
          factoryInvocation.isFactoryPathResult(node, path, isFactoryValue),
        propertyName,
        unwrap,
      }))
      ;({ valueMayBeRateLimiter: isFactoryBinderValue } = createValueTracker({
        context,
        findVariable,
        isDirectRateLimiter: (node) => factoryInvocation.isFactoryBinder(node, isFactoryValue),
        propertyName,
        unwrap,
      }))
      const virtualMatrix = createVirtualMatrixTracker({
        context,
        createValueTracker,
        findVariable,
        propertyName,
        unwrap,
        options: options.virtualMatrix,
      })
      const containsRestrictedCapability = createExportContainerTracker({
        context,
        createValueTracker,
        findVariable,
        isCapability: (node) => isFactoryValue(node) || virtualMatrix.isBuilderValue(node),
        isNamespace: (node) => isNamespaceValue(node) || virtualMatrix.isNamespaceValue(node),
        propertyName,
        unwrap,
      })
      const reportExportedValue = (node) =>
        node.exportKind !== 'type' && context.report({ messageId: 'constructionOwner', node })
      const reportFactoryInvocation = (node) =>
        isFactoryValue(factoryInvocation.invokedFactory(node, isFactoryValue)) &&
        context.report({ messageId: 'constructionOwner', node })
      return {
        CallExpression(node) {
          reportFactoryInvocation(node)
          if (virtualMatrix.isInvalidBuilderCall(node)) {
            context.report({ messageId: 'constructionOwner', node })
          }
        },
        ...factoryInvocation.executionVisitors(isFactoryValue, reportFactoryInvocation),
        ExportAllDeclaration(node) {
          if (
            MODULES.has(node.source?.value) ||
            virtualMatrix.isVirtualProgramSource(node.source?.value)
          )
            reportExportedValue(node)
        },
        ExportDefaultDeclaration(node) {
          if (containsRestrictedCapability(node.declaration)) reportExportedValue(node)
        },
        ExportNamedDeclaration(node) {
          if (node.exportKind === 'type') return
          if (node.source && MODULES.has(node.source.value)) {
            for (const specifier of node.specifiers) {
              const imported = specifier.local?.name ?? specifier.local?.value
              if (
                specifier.exportKind !== 'type' &&
                (imported === 'default' || FACTORIES.has(imported))
              )
                reportExportedValue(specifier)
            }
            return
          }
          if (node.source && virtualMatrix.isVirtualProgramSource(node.source.value)) {
            for (const specifier of node.specifiers) {
              if (
                specifier.exportKind !== 'type' &&
                (specifier.local?.name ?? specifier.local?.value) === options.virtualMatrix?.builder
              )
                reportExportedValue(specifier)
            }
            return
          }
          if (node.declaration?.type === 'VariableDeclaration') {
            for (const declaration of node.declaration.declarations) {
              if (
                bindingIdentifiers(declaration.id).some((identifier) =>
                  containsRestrictedCapability(identifier),
                )
              )
                reportExportedValue(declaration)
            }
          }
          for (const specifier of node.specifiers) {
            if (specifier.exportKind !== 'type' && containsRestrictedCapability(specifier.local)) {
              reportExportedValue(specifier)
            }
          }
        },
      }
    },
  }
}

module.exports = { createTypescriptProgramConstructionRule }
