import type { NodeLike } from './ast-helpers.mts'
import {
  namedPatternDefaultSource,
  namedPatternSource,
} from './factory-owner-provenance-binding.mts'
import { patternDefaultValue } from './factory-owner-pattern-default.mts'

export function isNamespacePatternBinding(
  declarator: NodeLike,
  localName: string,
  isNamespace: (value: NodeLike) => boolean,
): boolean {
  const selected = namedPatternSource(declarator, localName, new Set(['default']))
  if (selected && isNamespace(selected)) return true
  const defaultSource = namedPatternDefaultSource(
    declarator.id as NodeLike,
    localName,
    new Set(['default']),
  )
  if (defaultSource && isNamespace(defaultSource)) return true
  const fallback = patternDefaultValue(declarator.id as NodeLike, localName)
  if (fallback) return isNamespace(fallback)
  return (declarator.id as NodeLike).type === 'Identifier'
    ? isNamespace(declarator.init as NodeLike)
    : false
}
