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
  const entries: StructuredTypeEntry[] = []
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const value = getPropertyNameText(property.name)
    if (!value) continue
    const body = unwrapExpression(property.initializer)
    if (!ts.isObjectLiteralExpression(body)) continue
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
  const entries = new Map<string, string>()
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const key = getPropertyNameText(property.name)
    if (!key) continue
    const value = getStringLiteralValue(property.initializer)
    if (!value) continue
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
  for (const call of collectCallExpressions(content, file)) {
    callPattern.lastIndex = 0
    if (!callPattern.test(getCallExpressionName(call.expression) ?? '')) continue
    const unionType = getStringLiteralValue(call.arguments[0])
    const slug = getStringLiteralValue(call.arguments[1])
    if (unionType && slug) args.push({ unionType, slug })
  }
  return args
}

export function parseStructuredRouteFactoryArgs(
  content: string,
  file: string,
  callPattern: RegExp,
): StructuredRouteFactoryArgs[] {
  const args: StructuredRouteFactoryArgs[] = []
  for (const call of collectCallExpressions(content, file)) {
    callPattern.lastIndex = 0
    if (!callPattern.test(getCallExpressionName(call.expression) ?? '')) continue
    const slug = getStringLiteralValue(call.arguments[0])
    if (!slug) throw new Error(`${file}: configured route factory call needs a string literal slug`)
    args.push({ slug })
  }
  return args
}
