import type { NodeLike, RuleContextLike } from './ast-helpers.mts'
import {
  bindingNodes,
  mutableExportInitializer,
  patternSelectsFactory,
} from './factory-owner-export-pattern.mts'
import { patternDefaultValues } from './factory-owner-pattern-default.mts'
import type { FactoryProvenanceOptions } from './factory-owner-provenance.mts'

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
      if (restricted(node(value.declaration))) report(value)
    },
    TSExportAssignment(value) {
      if (restricted(node(value.expression))) report(value)
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
          !declaration.isTypeOnly &&
          ((moduleName !== null && options.modules.has(moduleName)) ||
            provenance.isFactory(node(declaration.id)))
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
