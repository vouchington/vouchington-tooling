import ts from '../contract-schema/typescript-api.mts'
import { methodAccess, contextResponseMethod } from './protocol-http-method-access.mts'

/** These installed platform operations set headers or throw; they do not emit a body. */
export function createHttpContextPlatformMethodProof(
  checker: ts.TypeChecker,
  sources: readonly ts.SourceFile[],
  options: ts.CompilerOptions,
) {
  const classes = new Set<ts.ClassDeclaration>()
  const applications = new Set<ts.Symbol>()
  for (const source of sources) {
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
        continue
      if (statement.moduleSpecifier.text !== '@jongleberry/api-server') continue
      const resolved = ts.resolveModuleName(
        statement.moduleSpecifier.text,
        source.fileName,
        options,
        ts.sys,
      ).resolvedModule
      if (resolved?.packageId?.name !== '@jongleberry/api-server') continue
      const module = checker.getSymbolAtLocation(statement.moduleSpecifier)
      const application =
        module && checker.getExportsOfModule(module).find((symbol) => symbol.name === 'Application')
      if (application)
        applications.add(
          application.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(application)
            : application,
        )
      const context =
        module && checker.getExportsOfModule(module).find((symbol) => symbol.name === 'Context')
      const target =
        context &&
        (context.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(context) : context)
      target?.declarations?.forEach((node) => {
        if (ts.isClassDeclaration(node)) classes.add(node)
      })
    }
  }
  const platformMethod = (call: ts.CallExpression, context: ts.Symbol): boolean => {
    const access = methodAccess(call.expression)
    if (
      !access ||
      !['set', 'setType', 'throw', 'cacheControl'].includes(access.name) ||
      contextResponseMethod(call.expression, context, checker, true) !== access.name
    )
      return false
    const member = checker.getPropertyOfType(
      checker.getTypeAtLocation(access.receiver),
      access.name,
    )
    return (
      !!member?.declarations?.length &&
      member.declarations.every(
        (node) => ts.isMethodDeclaration(node) && classes.has(node.parent as ts.ClassDeclaration),
      )
    )
  }
  return {
    platformMethod,
    applicationClass: applications.size === 1 ? [...applications][0] : undefined,
  }
}
