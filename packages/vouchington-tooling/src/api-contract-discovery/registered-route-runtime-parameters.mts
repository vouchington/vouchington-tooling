import ts from '../contract-schema/typescript-api.mts'

/** TypeScript's explicit this parameter is erased and consumes no runtime argument. */
export function runtimeParameters(node: ts.FunctionLikeDeclaration): ts.ParameterDeclaration[] {
  return node.parameters.filter(
    (parameter) => !ts.isIdentifier(parameter.name) || parameter.name.text !== 'this',
  )
}
