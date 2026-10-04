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

export interface TopicTypeEntry {
  value: string
  slug: string
  slugPlural: string
}

export interface PostRouteConfigEntry {
  key: string
  postTypes: string[]
  pluralPath: string
  singularPath: string
}

export interface TopicRouteConfigEntry {
  key: string
  topicTypes: string[]
  pluralPath: string
  singularPath: string
  spendingCategory: boolean
}

export interface PostDetailRouteFactoryArgs {
  postType: string
  slug: string
}

export interface TopicRouteFactoryArgs {
  slug: string
}

export function parseTopicTypeEntries(
  content: string,
  file: string,
  name: string,
  slugProperty: string,
  slugPluralProperty: string,
): TopicTypeEntry[] {
  const object = findConstObjectLiteral(content, name, file)
  const entries: TopicTypeEntry[] = []
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

export function parsePostSlugToType(
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

export function parsePostTypeUnion(content: string, file: string, name: string): string[] {
  const typeAlias = findTypeAliasDeclaration(content, name, file)
  const values = collectStringLiteralsFromType(typeAlias.type)
  if (values.length === 0) throw new Error(`${file}: ${name} union has no values`)
  return values
}

export function parsePostRouteConfigEntries(
  content: string,
  file: string,
  name: string,
  typeProperty: string,
  pluralPathProperty: string,
  singularPathProperty: string,
): PostRouteConfigEntry[] {
  return parseRouteConfigEntries(content, name, file, pluralPathProperty, singularPathProperty).map(
    (entry) => ({
      ...entry,
      postTypes: parseStringArray(entry.body, typeProperty),
    }),
  )
}

export function parseTopicRouteConfigEntries(
  content: string,
  file: string,
  name: string,
  typeProperty: string,
  categoryProperty: string,
  pluralPathProperty: string,
  singularPathProperty: string,
): TopicRouteConfigEntry[] {
  return parseRouteConfigEntries(content, name, file, pluralPathProperty, singularPathProperty).map(
    (entry) => ({
      ...entry,
      topicTypes: parseStringArray(entry.body, typeProperty),
      spendingCategory: hasTrueProperty(entry.body, categoryProperty),
    }),
  )
}

export function parsePostDetailRouteFactoryArgs(
  content: string,
  file: string,
  callPattern: RegExp,
): PostDetailRouteFactoryArgs[] {
  const args: PostDetailRouteFactoryArgs[] = []
  for (const call of collectCallExpressions(content, file)) {
    callPattern.lastIndex = 0
    if (!callPattern.test(getCallExpressionName(call.expression) ?? '')) continue
    const postType = getStringLiteralValue(call.arguments[0])
    const slug = getStringLiteralValue(call.arguments[1])
    if (postType && slug) args.push({ postType, slug })
  }
  return args
}

export function parseTopicRouteFactoryArgs(
  content: string,
  file: string,
  callPattern: RegExp,
): TopicRouteFactoryArgs[] {
  const args: TopicRouteFactoryArgs[] = []
  for (const call of collectCallExpressions(content, file)) {
    callPattern.lastIndex = 0
    if (!callPattern.test(getCallExpressionName(call.expression) ?? '')) continue
    const slug = getStringLiteralValue(call.arguments[0])
    if (slug) args.push({ slug })
  }
  return args
}
