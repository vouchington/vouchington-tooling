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
    if (!ts.isPropertyAssignment(property))
      throw new Error(`${file}: ${name} contains an uninspectable route member`)
    const key = ts.isComputedPropertyName(property.name)
      ? getStringLiteralValue(property.name.expression)
      : getPropertyNameText(property.name)
    if (!key) throw new Error(`${file}: ${name} contains an uninspectable route key`)
    if (key === '__proto__' && !ts.isComputedPropertyName(property.name))
      throw new Error(`${file}: ${name} contains unsupported __proto__ prototype setter`)
    const body = unwrapExpression(property.initializer)
    if (!ts.isObjectLiteralExpression(body))
      throw new Error(`${file}: ${name}.${key} must be an object literal`)
    const names = new Set<string>()
    for (const member of body.properties) {
      if (!ts.isPropertyAssignment(member))
        throw new Error(`${file}: ${name}.${key} contains an uninspectable member`)
      const memberName = getPropertyNameText(member.name)
      if (!memberName || names.has(memberName))
        throw new Error(`${file}: ${name}.${key} contains an uninspectable or duplicate key`)
      names.add(memberName)
    }
    const pluralPath = getStringProperty(body, pluralPathProperty)
    const singularPath = getStringProperty(body, singularPathProperty)
    if (!pluralPath) throw new Error(`${file}: ${name}.${key} is missing ${pluralPathProperty}`)
    if (!singularPath) throw new Error(`${file}: ${name}.${key} is missing ${singularPathProperty}`)
    entries.push({ key, body, pluralPath, singularPath })
  }
  if (entries.length === 0) throw new Error(`${file}: could not parse ${name} entries`)
  return entries
}

export function parseStringArray(
  content: ts.ObjectLiteralExpression,
  property: string,
  file: string,
): string[] {
  const array = getPropertyValue(content, property)
  if (!array) return []
  if (!ts.isArrayLiteralExpression(array))
    throw new Error(`${file}: ${property} must be a literal string array`)
  return array.elements.map((element) => {
    const value = getStringLiteralValue(element)
    if (value === undefined)
      throw new Error(`${file}: ${property} contains a non-string literal element`)
    return value
  })
}

export function collectStringLiteralsFromType(type: ts.TypeNode): string[] {
  const node = unwrapTypeNode(type)
  if (ts.isUnionTypeNode(node))
    return node.types.flatMap((item) => collectStringLiteralsFromType(item))
  const value = ts.isLiteralTypeNode(node) ? getStringLiteralValue(node.literal) : undefined
  if (value === undefined) throw new Error('union contains a non-string literal constituent')
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
  return getPropertyValue(object, property)?.kind === ts.SyntaxKind.TrueKeyword
}

function unwrapTypeNode(type: ts.TypeNode): ts.TypeNode {
  let current = type
  while (ts.isParenthesizedTypeNode(current)) current = current.type
  return current
}
