import ts from './typescript-api.mts'

import {
  exportedAssignableType,
  exportedDefaultType,
  exportedType,
  sourceFileForQuery,
  type ExportedTypeSelector,
} from './type-query-export.mts'

export type { ExportedTypeSelector } from './type-query-export.mts'

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
  readonly program: ts.Program
  readonly defaultTypeParameterIndex?: number
}

export function factsForType(
  program: ts.Program,
  checker: ts.TypeChecker,
  type: ts.Type,
  at: ts.Node,
  request: TypeFactsRequest,
): TypeFacts {
  const properties = Object.fromEntries(
    [...new Set(request.propertyNames ?? [])].sort().map((name) => {
      const property = checker.getPropertyOfType(type, name)
      const display = property
        ? checker.typeToString(checker.getTypeOfSymbolAtLocation(property, at))
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
            checker.isTypeAssignableTo(type, exportedAssignableType(program, checker, target)),
          ] as const,
      ),
  )
  return {
    display: checker.typeToString(type),
    isAny: Boolean(type.flags & ts.TypeFlags.Any),
    properties,
    assignableTo,
  }
}

export function getExportedTypeFacts(request: ExportedTypeFactsRequest): TypeFacts {
  const checker = request.program.getTypeChecker()
  const sourceFile = sourceFileForQuery(request.program, request.fileName)
  const type =
    request.defaultTypeParameterIndex === undefined
      ? exportedType(request.program, checker, request)
      : exportedDefaultType(request.program, checker, request, request.defaultTypeParameterIndex)
  return factsForType(request.program, checker, type, sourceFile, request)
}
