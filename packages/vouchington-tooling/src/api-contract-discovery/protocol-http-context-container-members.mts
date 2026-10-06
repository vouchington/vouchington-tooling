import ts from '../contract-schema/typescript-api.mts'

/** Class evaluation exposes static initializers and blocks on the escaped constructor. */
export function httpContextContainerMembers(value: ts.Expression): readonly ts.Node[] | undefined {
  if (ts.isObjectLiteralExpression(value) || ts.isArrayLiteralExpression(value)) return [value]
  if (!ts.isClassExpression(value)) return undefined
  return value.members.flatMap<ts.Node>((member) => {
    if (ts.isClassStaticBlockDeclaration(member)) return [member.body]
    return ts.isPropertyDeclaration(member) &&
      member.initializer &&
      ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static
      ? [member.initializer]
      : []
  })
}
