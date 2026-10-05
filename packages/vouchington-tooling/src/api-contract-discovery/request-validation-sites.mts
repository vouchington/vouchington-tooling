import ts from '../contract-schema/typescript-api.mts'
import { resolveKey, resolveObject, resolveOptionString } from './request-validation-keys.mts'
import type { Scope } from './request-validation-follow.mts'
import { traceValue } from './request-validation-trace.mts'
import {
  CARRIERS,
  type Carrier,
  type FactoryConfig,
  type FactorySite,
  type ValidatorConfig,
  type ValidatorSite,
} from './request-validation-types.mts'

export function sourceOf(node: ts.Node): string {
  const file = node.getSourceFile()
  return `${file.fileName}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
}

const propertyKey = (name: ts.PropertyName) =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined

function inputObjectCarriers(
  input: ts.Expression | undefined,
  scope: Scope,
): ValidatorSite['carriers'] {
  const object = resolveObject(input, scope.checker)
  const carriers: ValidatorSite['carriers'] = []
  for (const property of object?.properties ?? []) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
    const carrier = CARRIERS.find((candidate) => candidate === propertyKey(property.name))
    if (!carrier || carriers.some((item) => item.carrier === carrier)) continue
    const value = ts.isPropertyAssignment(property) ? property.initializer : property.name
    const { origins, unresolved } = traceValue(value, scope)
    carriers.push({
      carrier,
      origins: CARRIERS.filter((candidate) => origins.has(candidate)),
      ...(unresolved && { unresolved }),
    })
  }
  return carriers
}

/** True when the options object at the argument literally sets `property: true`. */
function optionIsTrue(options: ts.Expression | undefined, property: string, scope: Scope) {
  return !!resolveObject(options, scope.checker)?.properties.some(
    (item) =>
      ts.isPropertyAssignment(item) &&
      propertyKey(item.name) === property &&
      item.initializer.kind === ts.SyntaxKind.TrueKeyword,
  )
}

function fixedCarriers(
  config: Extract<ValidatorConfig['carriers'], { kind: 'fixed' }>,
  call: ts.CallExpression,
  scope: Scope,
): Carrier[] {
  const added = (config.optionCarriers ?? [])
    .filter((option) => optionIsTrue(call.arguments[option.argument], option.property, scope))
    .map((option) => option.carrier)
  return [...new Set([...config.carriers, ...added])]
}

export function validatorSite(
  call: ts.CallExpression,
  config: ValidatorConfig,
  scope: Scope,
  conditional: boolean,
): ValidatorSite {
  const argument = call.arguments[config.operationArgument]
  const operation = resolveKey(argument, scope.checker, scope.keys) ?? null
  const carriers =
    config.carriers.kind === 'input-object'
      ? inputObjectCarriers(call.arguments[config.carriers.argument], scope)
      : fixedCarriers(config.carriers, call, scope).map((carrier) => ({
          carrier,
          origins: [carrier],
        }))
  return {
    exportName: config.exportName,
    source: sourceOf(call),
    operation,
    ...(operation === null && { unresolvedReason: unresolved(argument) }),
    carriers,
    conditional,
  }
}

export function factorySite(
  call: ts.CallExpression,
  config: FactoryConfig,
  scope: Scope,
): FactorySite {
  const operation =
    resolveOptionString(
      call.arguments[config.optionsArgument],
      config.operationProperty,
      scope.checker,
      scope.keys,
    ) ?? null
  return {
    exportName: config.exportName,
    source: sourceOf(call),
    operation,
    ...(operation === null && {
      unresolvedReason: `option "${config.operationProperty}" is not statically resolvable`,
    }),
    carriers: [...config.carriers],
  }
}

function unresolved(argument: ts.Expression | undefined): string {
  return argument
    ? `operation key \`${argument.getText()}\` is not statically resolvable`
    : 'operation argument is missing'
}
