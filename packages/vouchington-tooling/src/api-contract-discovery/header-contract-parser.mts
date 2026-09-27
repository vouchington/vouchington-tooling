import ts from '../contract-schema/typescript-api.mts'

import { contractError } from './response-contract-registration.mts'
import type {
  HeaderContract,
  HeaderDescriptor,
  ResponseHeaderDescriptor,
} from './header-contract-types.mts'

export function parseHeaderContract(
  sourceFile: ts.SourceFile,
  node: ts.ObjectLiteralExpression,
): HeaderContract {
  const request = propertyObject(sourceFile, node, 'request')
  const responses = propertyObject(sourceFile, node, 'responses')
  return {
    requestHeaders: request ? parseHeaders(sourceFile, request) : {},
    responseHeaders: responses ? parseResponses(sourceFile, responses) : {},
  }
}

function parseResponses(
  sourceFile: ts.SourceFile,
  node: ts.ObjectLiteralExpression,
): Record<number, ResponseHeaderDescriptor> {
  const result: Record<number, ResponseHeaderDescriptor> = {}
  for (const property of node.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !ts.isNumericLiteral(property.name) ||
      !ts.isObjectLiteralExpression(property.initializer)
    )
      throw contractError(
        sourceFile,
        property,
        'apiHeaders response status must be a numeric object property',
      )
    const status = Number(property.name.text)
    const errors = property.initializer.properties.find(
      (item) => ts.isPropertyAssignment(item) && item.name.getText(sourceFile) === 'errors',
    )
    const headers = propertyObject(sourceFile, property.initializer, 'headers')
    const description = stringProperty(property.initializer, 'description')
    result[status] = {
      ...(description ? { description } : {}),
      ...(errors ? { errors: parseErrors(sourceFile, property.initializer) } : {}),
      headers: headers ? parseHeaders(sourceFile, headers) : {},
    }
  }
  return result
}

function parseErrors(
  sourceFile: ts.SourceFile,
  node: ts.ObjectLiteralExpression,
): readonly { code: string; message: string }[] {
  const property = findProperty(node, 'errors', sourceFile)
  if (!property || !ts.isArrayLiteralExpression(property.initializer))
    throw contractError(sourceFile, node, 'apiHeaders errors must be an array')
  return property.initializer.elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element))
      throw contractError(sourceFile, element, 'apiHeaders errors entries must be objects')
    return {
      code: requiredString(sourceFile, element, 'code'),
      message: requiredString(sourceFile, element, 'message'),
    }
  })
}

function parseHeaders(
  sourceFile: ts.SourceFile,
  node: ts.ObjectLiteralExpression,
): Record<string, HeaderDescriptor> {
  const result: Record<string, HeaderDescriptor> = Object.create(null) as Record<
    string,
    HeaderDescriptor
  >
  for (const property of node.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !ts.isStringLiteral(property.name) ||
      !ts.isObjectLiteralExpression(property.initializer)
    )
      throw contractError(
        sourceFile,
        property,
        'apiHeaders header must be a string-keyed object property',
      )
    const description = stringProperty(property.initializer, 'description')
    const format = stringProperty(property.initializer, 'format')
    result[property.name.text] = {
      type: requiredString(sourceFile, property.initializer, 'type') as HeaderDescriptor['type'],
      required: booleanProperty(property.initializer, 'required') ?? false,
      ...(format ? { format: format as 'uuid' } : {}),
      ...(description ? { description } : {}),
    }
  }
  return result
}

function propertyObject(
  sourceFile: ts.SourceFile,
  node: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  const property = findProperty(node, name, sourceFile)
  if (!property) return undefined
  if (!ts.isObjectLiteralExpression(property.initializer))
    throw contractError(sourceFile, property, `apiHeaders ${name} must be an object`)
  return property.initializer
}

function stringProperty(node: ts.ObjectLiteralExpression, name: string): string | undefined {
  const property = findProperty(node, name)
  return property && ts.isStringLiteral(property.initializer)
    ? property.initializer.text
    : undefined
}

function requiredString(
  sourceFile: ts.SourceFile,
  node: ts.ObjectLiteralExpression,
  name: string,
): string {
  const value = stringProperty(node, name)
  if (!value) throw contractError(sourceFile, node, `apiHeaders requires string ${name}`)
  return value
}

function booleanProperty(node: ts.ObjectLiteralExpression, name: string): boolean | undefined {
  const property = findProperty(node, name)
  if (!property) return undefined
  if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) return true
  if (property.initializer.kind === ts.SyntaxKind.FalseKeyword) return false
  return undefined
}

function findProperty(
  node: ts.ObjectLiteralExpression,
  name: string,
  sourceFile?: ts.SourceFile,
): ts.PropertyAssignment | undefined {
  return node.properties.find(
    (item): item is ts.PropertyAssignment =>
      ts.isPropertyAssignment(item) && item.name.getText(sourceFile) === name,
  )
}
