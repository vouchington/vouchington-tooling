import ts from '@typescript/typescript6'
import {
  findConstObjectLiteral,
  getPropertyNameText,
  getStringLiteralValue,
  unwrapExpression,
} from './ast.mts'

export function parseRouteConfigEntries(
  content: string,
  name: string,
  file: string,
  pluralPathProperty: string,
  singularPathProperty: string,
) {
  const object = findConstObjectLiteral(content, name, file)
  const entries: {
    key: string
    body: ts.ObjectLiteralExpression
    pluralPath: string
    singularPath: string
  }[] = []
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const key = getPropertyNameText(property.name)
    if (!key) continue
    const body = unwrapExpression(property.initializer)
    if (!ts.isObjectLiteralExpression(body)) continue
    const pluralPath = getStringProperty(body, pluralPathProperty)
    const singularPath = getStringProperty(body, singularPathProperty)
    if (!pluralPath) throw new Error(`${file}: ${name}.${key} is missing ${pluralPathProperty}`)
    if (!singularPath) throw new Error(`${file}: ${name}.${key} is missing ${singularPathProperty}`)
    entries.push({ key, body, pluralPath, singularPath })
  }
  if (entries.length === 0) throw new Error(`${file}: could not parse ${name} entries`)
  return entries
}

export function parseStringArray(content: ts.ObjectLiteralExpression, property: string): string[] {
  const array = getPropertyValue(content, property)
  if (!array || !ts.isArrayLiteralExpression(array)) return []
  return array.elements.flatMap((element) => {
    const value = getStringLiteralValue(element)
    return value ? [value] : []
  })
}

export function collectStringLiteralsFromType(type: ts.TypeNode): string[] {
  const node = unwrapTypeNode(type)
  if (ts.isUnionTypeNode(node))
    return node.types.flatMap((item) => collectStringLiteralsFromType(item))
  const value = ts.isLiteralTypeNode(node) ? getStringLiteralValue(node.literal) : undefined
  if (!value) throw new Error('union contains a non-string literal constituent')
  return [value]
}

function getPropertyValue(
  object: ts.ObjectLiteralExpression,
  property: string,
): ts.Expression | undefined {
  for (const member of object.properties) {
    if (!ts.isPropertyAssignment(member)) continue
    const key = getPropertyNameText(member.name)
    if (key === property) return unwrapExpression(member.initializer)
  }
  return undefined
}

export function getStringProperty(
  object: ts.ObjectLiteralExpression,
  property: string,
): string | undefined {
  return getStringLiteralValue(getPropertyValue(object, property))
}

export function hasTrueProperty(object: ts.ObjectLiteralExpression, property: string): boolean {
  for (const member of object.properties) {
    if (!ts.isPropertyAssignment(member)) continue
    const key = getPropertyNameText(member.name)
    if (key !== property) continue
    return unwrapExpression(member.initializer).kind === ts.SyntaxKind.TrueKeyword
  }
  return false
}

function unwrapTypeNode(type: ts.TypeNode): ts.TypeNode {
  let current = type
  while (ts.isParenthesizedTypeNode(current)) current = current.type
  return current
}
