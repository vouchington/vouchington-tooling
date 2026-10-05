import type { QueryParameterContract } from './query-contract-types.mts'
import ts from '../contract-schema/typescript-api.mts'

import { contractError } from './response-contract-registration.mts'
import {
  optionalNumberLiteral,
  declaresProperty,
  optionalTrueLiteral,
  optionalStringLiteral,
  requiredBooleanLiteral,
  requiredNumberLiteral,
  requiredPropertyType,
  requiredStringLiteral,
  stringTuple,
} from './query-contract-literals.mts'

export function extractQueryParameterDescriptor(
  type: ts.Type,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  parameterName: string,
): QueryParameterContract {
  const descriptor = extractDescriptorShape(type, checker, sourceFile, node, parameterName)
  if (!optionalTrueLiteral(type, 'required', checker, failure(sourceFile, node, parameterName))) {
    return descriptor
  }
  if (declaresProperty(type, 'default')) {
    failure(sourceFile, node, parameterName)('required cannot be combined with default')
  }
  return { ...descriptor, required: true }
}

function failure(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  parameterName: string,
): (detail: string) => never {
  return (detail) => {
    throw contractError(sourceFile, node, `Malformed query parameter "${parameterName}": ${detail}`)
  }
}

function extractDescriptorShape(
  type: ts.Type,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  parameterName: string,
): QueryParameterContract {
  const fail = failure(sourceFile, node, parameterName)
  const kind = requiredStringLiteral(type, 'kind', checker, fail)
  const description = optionalStringLiteral(type, 'description', checker, node, fail)
  const options = description === undefined ? {} : { description }

  if (kind === 'string') {
    const format = optionalStringLiteral(type, 'format', checker, node, fail)
    if (format === 'uuid') return { kind, format, ...options }
    if (format === 'uri') return { kind, format, ...options }
    if (format !== undefined) fail('unsupported format')
    return { kind, ...options }
  }
  if (
    kind === 'uuid-or-uri' ||
    kind === 'boolean' ||
    kind === 'nullable-boolean' ||
    kind === 'number'
  ) {
    return { kind, ...options }
  }
  if (kind === 'integer') {
    const minimum = requiredNumberLiteral(type, 'minimum', checker, fail)
    const maximum = requiredNumberLiteral(type, 'maximum', checker, fail)
    const defaultValue = optionalNumberLiteral(type, 'default', checker, node, fail)
    return {
      kind,
      minimum,
      maximum,
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
      ...options,
    }
  }
  if (kind === 'enum') {
    const values = stringTuple(type, 'values', checker, fail)
    const defaultValue = optionalStringLiteral(type, 'default', checker, node, fail)
    if (defaultValue !== undefined && !values.includes(defaultValue)) {
      fail('default must be one of values')
    }
    return {
      kind,
      values,
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
      ...options,
    }
  }
  if (kind === 'csv-array') {
    if (requiredStringLiteral(type, 'style', checker, fail) !== 'form') fail('style must be form')
    if (requiredBooleanLiteral(type, 'explode', checker, fail) !== false)
      fail('explode must be false')
    const itemType = requiredPropertyType(type, 'items', checker, fail)
    if (declaresProperty(itemType, 'required')) fail('array items cannot be required')
    const items = extractDescriptorShape(itemType, checker, sourceFile, node, `${parameterName}[]`)
    if (items.kind === 'string' || items.kind === 'enum') {
      return { kind, items, style: 'form', explode: false, ...options }
    }
    return fail('array items must be string or enum')
  }
  return fail(`unsupported kind "${kind}"`)
}
