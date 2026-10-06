import ts from '@typescript/typescript6'

import {
  collectCallExpressions,
  findConstObjectLiteral,
  findTypeAliasDeclaration,
  getCallExpressionName,
  getPropertyNameText,
  getStringLiteralValue,
  unwrapExpression,
} from './ast.mts'
import {
  collectStringLiteralsFromType,
  getStringProperty,
  hasTrueProperty,
  parseRouteConfigEntries,
  parseStringArray,
} from './parser-support.mts'
import { hasPostDeclarationConfiguredObjectMutation } from './configured-object-mutations.mts'

export interface StructuredTypeEntry {
  value: string
  slug: string
  slugPlural: string
}

export interface UnionRouteConfigEntry {
  key: string
  unionTypes: string[]
  pluralPath: string
  singularPath: string
}

export interface StructuredRouteConfigEntry {
  key: string
  structuredTypes: string[]
  pluralPath: string
  singularPath: string
  routeExempt: boolean
}

export interface UnionDetailRouteFactoryArgs {
  unionType: string
  slug: string
}

export interface StructuredRouteFactoryArgs {
  slug: string
}

export function parseStructuredTypeEntries(
  content: string,
  file: string,
  name: string,
  slugProperty: string,
  slugPluralProperty: string,
): StructuredTypeEntry[] {
  const object = findConstObjectLiteral(content, name, file)
  if (hasPostDeclarationConfiguredObjectMutation(content, file, name, object.end))
    throw new Error(`${file}: ${name} has a post-declaration property mutation`)
  const entries: StructuredTypeEntry[] = []
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property))
      throw new Error(`${file}: ${name} contains an uninspectable spread`)
    if (ts.isShorthandPropertyAssignment(property))
      throw new Error(`${file}: ${name}.${property.name.text} must be an object literal`)
    if (!ts.isPropertyAssignment(property)) continue
    const value = getPropertyNameText(property.name)
    if (value === '__proto__' && !ts.isComputedPropertyName(property.name))
      throw new Error(`${file}: ${name} contains unsupported __proto__ prototype setter`)
    if (value === undefined) continue
    const body = unwrapExpression(property.initializer)
    if (!ts.isObjectLiteralExpression(body))
      throw new Error(`${file}: ${name}.${value} must be an object literal`)
    const names = new Set<string>()
    for (const member of body.properties) {
      if (!ts.isPropertyAssignment(member))
        throw new Error(`${file}: ${name}.${value} contains an uninspectable member`)
      const memberName = getPropertyNameText(member.name)
      if (!memberName || names.has(memberName))
        throw new Error(`${file}: ${name}.${value} contains an uninspectable or duplicate key`)
      names.add(memberName)
    }
    const slug = getStringProperty(body, slugProperty)
    const slugPlural = getStringProperty(body, slugPluralProperty)
    if (!slug) throw new Error(`${file}: ${name}.${value} is missing ${slugProperty}`)
    if (!slugPlural) throw new Error(`${file}: ${name}.${value} is missing ${slugPluralProperty}`)
    entries.push({ value, slug, slugPlural })
  }
  if (entries.length === 0) throw new Error(`${file}: could not parse ${name} entries`)
  return entries
}

export function parseUnionSlugToType(
  content: string,
  file: string,
  name: string,
): Map<string, string> {
  const object = findConstObjectLiteral(content, name, file)
  if (hasPostDeclarationConfiguredObjectMutation(content, file, name, object.end))
    throw new Error(`${file}: ${name} has a post-declaration property mutation`)
  const entries = new Map<string, string>()
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property))
      throw new Error(`${file}: ${name} contains an uninspectable member`)
    const key = getPropertyNameText(property.name)
    if (!key) throw new Error(`${file}: ${name} contains an uninspectable key`)
    if (key === '__proto__' && !ts.isComputedPropertyName(property.name))
      throw new Error(`${file}: ${name} contains unsupported __proto__ prototype setter`)
    const value = getStringLiteralValue(property.initializer)
    if (value === undefined) throw new Error(`${file}: ${name}.${key} must be a string literal`)
    entries.set(key, value)
  }
  if (entries.size === 0) throw new Error(`${file}: could not parse ${name} entries`)
  return entries
}

export function parseUnionTypeUnion(content: string, file: string, name: string): string[] {
  const typeAlias = findTypeAliasDeclaration(content, name, file)
  return collectStringLiteralsFromType(typeAlias.type)
}

export function parseUnionRouteConfigEntries(
  content: string,
  file: string,
  name: string,
  typeProperty: string,
  pluralPathProperty: string,
  singularPathProperty: string,
): UnionRouteConfigEntry[] {
  return parseRouteConfigEntries(content, name, file, pluralPathProperty, singularPathProperty).map(
    (entry) => ({
      ...entry,
      unionTypes: parseStringArray(entry.body, typeProperty, file),
    }),
  )
}

export function parseStructuredRouteConfigEntries(
  content: string,
  file: string,
  name: string,
  typeProperty: string,
  exemptionProperty: string,
  pluralPathProperty: string,
  singularPathProperty: string,
): StructuredRouteConfigEntry[] {
  return parseRouteConfigEntries(content, name, file, pluralPathProperty, singularPathProperty).map(
    (entry) => ({
      ...entry,
      structuredTypes: parseStringArray(entry.body, typeProperty, file),
      routeExempt: hasTrueProperty(entry.body, exemptionProperty),
    }),
  )
}

export function parseUnionDetailRouteFactoryArgs(
  content: string,
  file: string,
  callPattern: RegExp,
): UnionDetailRouteFactoryArgs[] {
  const args: UnionDetailRouteFactoryArgs[] = []
  const matcher = new RegExp(callPattern.source, callPattern.flags)
  for (const call of collectCallExpressions(content, file)) {
    matcher.lastIndex = 0
    if (!matcher.test(getCallExpressionName(call.expression) ?? '')) continue
    const unionType = getStringLiteralValue(call.arguments[0])
    const slug = getStringLiteralValue(call.arguments[1])
    if (unionType === undefined || slug === undefined)
      throw new Error(`${file}: configured route factory call needs literal type and slug`)
    args.push({ unionType, slug })
  }
  return args
}

export function parseStructuredRouteFactoryArgs(
  content: string,
  file: string,
  callPattern: RegExp,
): StructuredRouteFactoryArgs[] {
  const args: StructuredRouteFactoryArgs[] = []
  const matcher = new RegExp(callPattern.source, callPattern.flags)
  for (const call of collectCallExpressions(content, file)) {
    matcher.lastIndex = 0
    if (!matcher.test(getCallExpressionName(call.expression) ?? '')) continue
    if (call.arguments.length === 0) continue
    const slug = getStringLiteralValue(call.arguments[0])
    if (!slug) throw new Error(`${file}: configured route factory call needs a string literal slug`)
    args.push({ slug })
  }
  return args
}
