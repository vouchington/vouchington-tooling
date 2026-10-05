import { unwrap, type NodeLike, type RuleContextLike } from './ast-helpers.mts'
import {
  bindingNodes,
  mutableExportInitializer,
  patternSelectsFactory,
} from './factory-owner-export-pattern.mts'
import { patternDefaultValues } from './factory-owner-pattern-default.mts'
import { namedPatternDefaultSource } from './factory-owner-provenance-binding.mts'
import type { FactoryProvenanceOptions } from './factory-owner-provenance.mts'
import { isValueImportEquals } from './factory-owner-require.mts'

function node(value: unknown): NodeLike | undefined {
  return value !== null && typeof value === 'object' && 'type' in value
    ? (value as NodeLike)
    : undefined
}

function name(value: unknown): string | null {
  const entry = node(value)
  if (typeof entry?.name === 'string') return entry.name
  return typeof entry?.value === 'string' ? entry.value : null
}

export function createFactoryExportVisitors(
  context: RuleContextLike,
  options: FactoryProvenanceOptions,
  provenance: {
    isFactory: (value: NodeLike | null | undefined) => boolean
    isNamespace: (value: NodeLike | null | undefined) => boolean
  },
): Record<string, (value: NodeLike) => void> {
  const report = (value: NodeLike) =>
    context.report({ node: value, messageId: 'constructionOwner' })
  const restricted = (value: NodeLike | undefined) =>
    provenance.isFactory(value) || provenance.isNamespace(value)
  const finalExpression = (value: NodeLike): NodeLike => {
    const current = unwrap(value) as NodeLike
    if (current.type === 'AwaitExpression') return finalExpression(current.argument as NodeLike)
    return current.type === 'SequenceExpression'
      ? finalExpression((current.expressions as NodeLike[]).at(-1) as NodeLike)
      : current
  }
  const restrictedExpression = (value: NodeLike) => {
    const current = finalExpression(value)
    return (
      restricted(value) ||
      (current?.type === 'Identifier' &&
        restricted(mutableExportInitializer(context, current, options.factories)))
    )
  }
  return {
    ExportAllDeclaration(value) {
      if (
        value.exportKind !== 'type' &&
        options.modules.has(String((value.source as NodeLike).value)) &&
        (value.exported || [...options.factories].some((name) => name !== 'default'))
      ) {
        report(value)
      }
    },
    ExportDefaultDeclaration(value) {
      if (restrictedExpression(node(value.declaration) as NodeLike)) report(value)
    },
    TSExportAssignment(value) {
      if (restrictedExpression(node(value.expression) as NodeLike)) report(value)
    },
    ExportNamedDeclaration(value) {
      if (value.exportKind === 'type') return
      const specifiers = value.specifiers as NodeLike[]
      const source = name(node(value.source))
      if (source !== null) {
        if (!options.modules.has(source)) return
        for (const specifier of specifiers) {
          const imported = name(node(specifier.local))
          if (
            specifier.exportKind !== 'type' &&
            (imported === 'default' || (imported !== null && options.factories.has(imported)))
          )
            report(specifier)
        }
        return
      }
      const declaration = node(value.declaration)
      if (declaration?.type === 'TSImportEqualsDeclaration') {
        const moduleReference = node(declaration.moduleReference)
        const moduleName = name(node(moduleReference?.expression))
        if (
          isValueImportEquals(declaration) &&
          ((moduleName !== null && options.modules.has(moduleName)) ||
            restricted(node(declaration.id)))
        )
          report(declaration)
      }
      if (declaration?.type === 'VariableDeclaration') {
        for (const declarator of declaration.declarations as NodeLike[]) {
          const id = node(declarator.id)
          const bindings =
            id?.type === 'ObjectPattern' || id?.type === 'ArrayPattern' ? bindingNodes(id) : [id]
          const initializer = node(declarator.init)
          if (
            bindings.some(restricted) ||
            (id ? patternDefaultValues(id).some(restricted) : false) ||
            (id
              ? bindings.some((binding) => {
                  const localName = typeof binding?.name === 'string' ? binding.name : null
                  const source = localName
                    ? namedPatternDefaultSource(id, localName, options.factories)
                    : null
                  return Boolean(source && provenance.isNamespace(source))
                })
              : false) ||
            (id?.type === 'Identifier' && restricted(initializer)) ||
            (id &&
              patternSelectsFactory(id, options.factories) &&
              provenance.isNamespace(initializer))
          )
            report(declarator)
        }
      }
      for (const specifier of specifiers) {
        const local = node(specifier.local)
        if (
          specifier.exportKind !== 'type' &&
          (restricted(local) ||
            (local?.type === 'Identifier' &&
              restricted(mutableExportInitializer(context, local, options.factories))))
        )
          report(specifier)
      }
    },
  }
}
