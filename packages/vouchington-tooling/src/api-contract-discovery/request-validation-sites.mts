import ts from '../contract-schema/typescript-api.mts'
import {
  propertyNameText,
  resolveKey,
  resolveObject,
  resolveOptionString,
} from './request-validation-keys.mts'
import type { Scope } from './request-validation-follow.mts'
import { resolveInput, type InputResolution } from './request-validation-input.mts'
import {
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

/** True when the options object at the argument literally sets `property: true`. */
function optionIsTrue(options: ts.Expression | undefined, property: string, scope: Scope) {
  return !!resolveObject(options, scope.checker)?.properties.some(
    (item) =>
      ts.isPropertyAssignment(item) &&
      propertyNameText(item.name) === property &&
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
): { site: ValidatorSite; inputNodes: ts.Node[] } {
  const argument = call.arguments[config.operationArgument]
  const operation = resolveKey(argument, scope.checker, scope.keys) ?? null
  const input: InputResolution =
    config.carriers.kind === 'input-object'
      ? resolveInput(call.arguments[config.carriers.argument], scope)
      : {
          carriers: fixedCarriers(config.carriers, call, scope).map((carrier) => ({
            carrier,
            origins: [carrier],
          })),
          nodes: [],
        }
  const site: ValidatorSite = {
    exportName: config.exportName,
    source: sourceOf(call),
    operation,
    ...(operation === null && { unresolvedReason: unresolved(argument) }),
    carriers: input.carriers,
    ...(input.unresolved && { unresolvedCarriers: input.unresolved }),
    conditional,
  }
  return { site, inputNodes: input.nodes }
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
