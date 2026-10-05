import type ts from './typescript-api.mts'

import { sourceFileForQuery } from './type-query-export.mts'
import { factsForType, type TypeFacts, type TypeFactsRequest } from './type-query.mts'
import {
  programForQuery,
  validateTypeScriptApi,
  type TypeScriptApi,
  type TypeScriptProgram,
} from './type-query-api.mts'

export interface CallRowTypeFactsRequest extends TypeFactsRequest {
  readonly program: TypeScriptProgram
  readonly typescript: TypeScriptApi
  readonly fileName: string
  readonly calleeText: string
  readonly rowSource: 'typeArgument' | 'awaitedRows'
  readonly typeArgumentIndex?: number
  readonly typeArgumentText?: string
}

export interface CallRowTypeFacts extends TypeFacts {
  readonly line: number
  readonly column: number
}

function rowType(
  typescript: TypeScriptApi,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  request: CallRowTypeFactsRequest,
): { type: ts.Type; at: ts.Node } {
  if (request.rowSource === 'typeArgument') {
    const typeArgument = call.typeArguments?.[request.typeArgumentIndex ?? 0]
    if (!typeArgument) {
      throw new Error(
        `Missing row type argument for call "${request.calleeText}" in "${sourceFile.fileName}"`,
      )
    }
    return { type: checker.getTypeFromTypeNode(typeArgument), at: typeArgument }
  }
  const result = checker.getAwaitedType(checker.getTypeAtLocation(call))
  if (result && result.flags & (typescript.TypeFlags.Any | typescript.TypeFlags.Never))
    return { type: result, at: call }
  const rowsProperty = result && checker.getPropertyOfType(result, 'rows')
  const rows = rowsProperty && checker.getTypeOfSymbolAtLocation(rowsProperty, call)
  if (rows && rows.flags & (typescript.TypeFlags.Any | typescript.TypeFlags.Never)) {
    return { type: rows, at: call }
  }
  const element = rows && checker.getIndexTypeOfType(rows, typescript.IndexKind.Number)
  if (!element) {
    throw new Error(
      `Missing awaited rows element for call "${request.calleeText}" in "${sourceFile.fileName}"`,
    )
  }
  return { type: element, at: call }
}

export function getCallRowTypeFacts(request: CallRowTypeFactsRequest): CallRowTypeFacts[] {
  const program = programForQuery(request.program)
  const sourceFile = sourceFileForQuery(program, request.fileName)
  validateTypeScriptApi(request.typescript, request.program, sourceFile)
  const checker = program.getTypeChecker()
  const facts: CallRowTypeFacts[] = []
  function visit(node: ts.Node): void {
    if (
      request.typescript.isCallExpression(node) &&
      node.expression.getText(sourceFile) === request.calleeText
    ) {
      const selectedText = node.typeArguments?.[request.typeArgumentIndex ?? 0]?.getText(sourceFile)
      if (request.typeArgumentText === undefined || selectedText === request.typeArgumentText) {
        const row = rowType(request.typescript, checker, sourceFile, node, request)
        const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        facts.push({
          line: location.line + 1,
          column: location.character + 1,
          ...factsForType(request.typescript, program, checker, row.type, row.at, request),
        })
      }
    }
    request.typescript.forEachChild(node, visit)
  }
  visit(sourceFile)
  return facts
}
