import ts from '../contract-schema/typescript-api.mts'

export function requiredPropertyType(
  type: ts.Type,
  name: string,
  checker: ts.TypeChecker,
  fail: (detail: string) => never,
): ts.Type {
  const property = type.getProperty(name)
  if (!property || property.flags & ts.SymbolFlags.Optional) return fail(`requires literal ${name}`)
  const location = property.valueDeclaration ?? property.declarations?.[0]
  if (!location) return fail(`requires declared ${name}`)
  return checker.getTypeOfSymbolAtLocation(property, location)
}

export function requiredStringLiteral(
  type: ts.Type,
  name: string,
  checker: ts.TypeChecker,
  fail: (detail: string) => never,
): string {
  const value = requiredPropertyType(type, name, checker, fail)
  return value.isStringLiteral() ? value.value : fail(`requires literal ${name}`)
}

export function requiredNumberLiteral(
  type: ts.Type,
  name: string,
  checker: ts.TypeChecker,
  fail: (detail: string) => never,
): number {
  const value = requiredPropertyType(type, name, checker, fail)
  return value.isNumberLiteral() ? value.value : fail(`requires literal ${name}`)
}

export function requiredBooleanLiteral(
  type: ts.Type,
  name: string,
  checker: ts.TypeChecker,
  fail: (detail: string) => never,
): boolean {
  const value = requiredPropertyType(type, name, checker, fail)
  if (value.flags & ts.TypeFlags.BooleanLiteral) return checker.typeToString(value) === 'true'
  return fail(`requires literal ${name}`)
}

export function optionalStringLiteral(
  type: ts.Type,
  name: string,
  checker: ts.TypeChecker,
  node: ts.Node,
  fail: (detail: string) => never,
): string | undefined {
  const property = type.getProperty(name)
  if (!property) return undefined
  if (property.flags & ts.SymbolFlags.Optional) return fail(`${name} must be literal when present`)
  const location = property.valueDeclaration ?? property.declarations?.[0] ?? node
  const value = checker.getTypeOfSymbolAtLocation(property, location)
  return value.isStringLiteral() ? value.value : fail(`requires literal ${name}`)
}

export function optionalNumberLiteral(
  type: ts.Type,
  name: string,
  checker: ts.TypeChecker,
  node: ts.Node,
  fail: (detail: string) => never,
): number | undefined {
  const property = type.getProperty(name)
  if (!property) return undefined
  if (property.flags & ts.SymbolFlags.Optional) return fail(`${name} must be literal when present`)
  const location = property.valueDeclaration ?? property.declarations?.[0] ?? node
  const value = checker.getTypeOfSymbolAtLocation(property, location)
  return value.isNumberLiteral() ? value.value : fail(`requires literal ${name}`)
}

export function optionalTrueLiteral(
  type: ts.Type,
  name: string,
  checker: ts.TypeChecker,
  node: ts.Node,
  fail: (detail: string) => never,
): boolean {
  const property = type.getProperty(name)
  if (!property) return false
  if (property.flags & ts.SymbolFlags.Optional) return fail(`${name} must be literal when present`)
  const location = property.valueDeclaration ?? property.declarations?.[0] ?? node
  const value = checker.getTypeOfSymbolAtLocation(property, location)
  const isTrue = value.flags & ts.TypeFlags.BooleanLiteral && checker.typeToString(value) === 'true'
  return isTrue ? true : fail(`${name} must be the literal true`)
}

export function stringTuple(
  type: ts.Type,
  name: string,
  checker: ts.TypeChecker,
  fail: (detail: string) => never,
): readonly string[] {
  const value = requiredPropertyType(type, name, checker, fail)
  if (!checker.isTupleType(value)) return fail(`${name} must be a literal tuple`)
  const values = checker.getTypeArguments(value as ts.TypeReference)
  if (values.length === 0 || values.some((item) => !item.isStringLiteral())) {
    return fail(`${name} must contain string literals`)
  }
  return values.map((item) => (item as ts.StringLiteralType).value)
}
