import type ts from './typescript-api.mts'

import {
  exportedAssignableType,
  exportedDefaultType,
  exportedType,
  sourceFileForQuery,
  type ExportedTypeSelector,
} from './type-query-export.mts'
import {
  programForQuery,
  validateTypeScriptApi,
  type TypeScriptApi,
  type TypeScriptProgram,
} from './type-query-api.mts'

export type { ExportedTypeSelector } from './type-query-export.mts'
export type { TypeScriptApi, TypeScriptProgram } from './type-query-api.mts'

export interface TypeFactsRequest {
  readonly propertyNames?: readonly string[]
  readonly assignableTo?: Readonly<Record<string, ExportedTypeSelector>>
}

export interface TypeFacts {
  readonly display: string
  readonly isAny: boolean
  readonly properties: Readonly<Record<string, string | undefined>>
  readonly assignableTo: Readonly<Record<string, boolean>>
}

export interface ExportedTypeFactsRequest extends ExportedTypeSelector, TypeFactsRequest {
  readonly program: TypeScriptProgram
  readonly typescript: TypeScriptApi
  readonly defaultTypeParameterIndex?: number
}

export function factsForType(
  typescript: TypeScriptApi,
  program: ts.Program,
  checker: ts.TypeChecker,
  type: ts.Type,
  at: ts.Node,
  request: TypeFactsRequest,
): TypeFacts {
  const properties = Object.fromEntries(
    [...new Set(request.propertyNames ?? [])].sort().map((name) => {
      const property = checker.getPropertyOfType(type, name)
      const numericName = Number(name)
      const numericKey = name.trim() !== '' && String(numericName) === name
      const propertyType = property
        ? checker.getTypeOfSymbolAtLocation(property, at)
        : (checker.getIndexTypeOfType(
            type,
            numericKey ? typescript.IndexKind.Number : typescript.IndexKind.String,
          ) ??
          (numericKey ? checker.getIndexTypeOfType(type, typescript.IndexKind.String) : undefined))
      const display = propertyType
        ? checker.typeToString(propertyType, undefined, typescript.TypeFormatFlags.NoTruncation)
        : undefined
      return [name, display] as const
    }),
  )
  const assignableTo = Object.fromEntries(
    Object.entries(request.assignableTo ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([label, target]) =>
          [
            label,
            checker.isTypeAssignableTo(
              type,
              exportedAssignableType(typescript, program, checker, target),
            ),
          ] as const,
      ),
  )
  return {
    display: checker.typeToString(type, undefined, typescript.TypeFormatFlags.NoTruncation),
    isAny: Boolean(type.flags & typescript.TypeFlags.Any),
    properties,
    assignableTo,
  }
}

export function getExportedTypeFacts(request: ExportedTypeFactsRequest): TypeFacts {
  const program = programForQuery(request.program)
  const checker = program.getTypeChecker()
  const sourceFile = sourceFileForQuery(program, request.fileName)
  validateTypeScriptApi(request.typescript, request.program, sourceFile)
  const type =
    request.defaultTypeParameterIndex === undefined
      ? exportedType(request.typescript, program, checker, request)
      : exportedDefaultType(
          request.typescript,
          program,
          checker,
          request,
          request.defaultTypeParameterIndex,
        )
  return factsForType(request.typescript, program, checker, type, sourceFile, request)
}
