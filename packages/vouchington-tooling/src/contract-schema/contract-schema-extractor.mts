import ts from './typescript-api.mts'

import { extractContractSchema } from './contract-schema-type-extractor.mts'
import { compareSymbols } from './contract-schema-type-utils.mts'
import type { ExtractContractSchemaOptions, ExtractedResponseContract } from './types.mts'

export function extractResponseContracts(
  program: ts.Program,
  sourceFile: ts.SourceFile,
  registryName = 'ApiResponseContracts',
  options: ExtractContractSchemaOptions = {},
): Record<string, ExtractedResponseContract> {
  const checker = program.getTypeChecker()
  const registry = findRegistryDeclaration(sourceFile, registryName)
  const registryType = checker.getTypeAtLocation(registry)
  const contracts: Record<string, ExtractedResponseContract> = {}

  for (const property of checker.getPropertiesOfType(registryType).toSorted(compareSymbols)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0]
    if (!declaration) throw new Error(`Contract "${property.name}" has no declaration`)
    const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration)
    contracts[property.name] = extractContractSchema(
      propertyType,
      checker,
      sourceFile.fileName,
      options,
    )
  }

  return contracts
}

function findRegistryDeclaration(sourceFile: ts.SourceFile, name: string): ts.InterfaceDeclaration {
  const declaration = sourceFile.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === name,
  )
  if (!declaration || !ts.isInterfaceDeclaration(declaration)) {
    throw new Error(`Response contract registry interface "${name}" was not found`)
  }
  return declaration
}
