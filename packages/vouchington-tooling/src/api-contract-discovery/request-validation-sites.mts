import ts from '../contract-schema/typescript-api.mts'
import {
  ABSENT,
  findProperty,
  resolveKey,
  resolveObject,
  resolveOptionString,
} from './request-validation-keys.mts'
import type { Scope } from './request-validation-follow.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'
import { resolveInput, type InputResolution } from './request-validation-input.mts'
import {
  type FactoryConfig,
  type FactorySite,
  type ValidatorConfig,
  type ValidatorSite,
} from './request-validation-types.mts'

export function sourceOf(node: ts.Node): string {
  const file = node.getSourceFile()
  return `${file.fileName}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
}

/** Whether the options object ends with `property: true`, applying spreads in order. */
function optionEnabled(options: ts.Expression | undefined, property: string, scope: Scope) {
  if (!options) return { enabled: false }
  const object = resolveObject(options, scope.checker, scope.roots)
  if (!object)
    return {
      enabled: false,
      unresolved: `options \`${options.getText()}\` are not statically resolvable`,
    }
  const found = findProperty(object, property, scope.checker, scope.roots, new Set([object]))
  if (found === undefined)
    return { enabled: false, unresolved: `option "${property}" is not statically resolvable` }
  return {
    enabled:
      found !== ABSENT && unwrapTransparentExpression(found).kind === ts.SyntaxKind.TrueKeyword,
  }
}

type FixedCarriers = Extract<ValidatorConfig['carriers'], { kind: 'fixed' }>

function fixedInput(config: FixedCarriers, call: ts.CallExpression, scope: Scope): InputResolution {
  const options = (config.optionCarriers ?? []).map((option) => ({
    option,
    ...optionEnabled(call.arguments[option.argument], option.property, scope),
  }))
  const added = options.filter((item) => item.enabled).map((item) => item.option.carrier)
  const unresolved = options.find((item) => item.unresolved)?.unresolved
  return {
    carriers: [...new Set([...config.carriers, ...added])].map((carrier) => ({
      carrier,
      origins: [carrier],
    })),
    ...(unresolved && { unresolved }),
    nodes: [],
  }
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
      : fixedInput(config.carriers, call, scope)
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
  conditional: boolean,
): FactorySite {
  const operation =
    resolveOptionString(
      call.arguments[config.optionsArgument],
      config.operationProperty,
      scope.checker,
      scope.keys,
      scope.roots,
    ) ?? null
  return {
    exportName: config.exportName,
    source: sourceOf(call),
    operation,
    ...(operation === null && {
      unresolvedReason: `option "${config.operationProperty}" is not statically resolvable`,
    }),
    carriers: [...config.carriers],
    conditional,
  }
}

function unresolved(argument: ts.Expression | undefined): string {
  return argument
    ? `operation key \`${argument.getText()}\` is not statically resolvable`
    : 'operation argument is missing'
}
