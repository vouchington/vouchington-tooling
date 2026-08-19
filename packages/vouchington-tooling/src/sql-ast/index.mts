type LibPgQuery = typeof import('@libpg-query/parser')

let parser: LibPgQuery | undefined
let moduleLoad: Promise<void> | undefined

export class MissingSqlAstParserError extends Error {
  constructor() {
    super(
      'vouchington-tooling/sql-ast requires the optional dependency @libpg-query/parser. Install it in the consuming package.',
    )
    this.name = 'MissingSqlAstParserError'
  }
}

export function extractAlterTableAddColumnLocations(content: string): number[] {
  const locations: number[] = []
  const parseResult = requireParser().parseSync(content)

  for (const rawStmt of parseResult.stmts ?? []) {
    const node = rawStmt.stmt
    if (!node || !('AlterTableStmt' in node)) continue

    for (const rawCommand of node.AlterTableStmt.cmds ?? []) {
      if (!rawCommand || !('AlterTableCmd' in rawCommand)) continue
      const command = rawCommand.AlterTableCmd
      if (command.subtype !== 'AT_AddColumn') continue

      const definition = command.def
      if (!definition || !('ColumnDef' in definition)) continue
      locations.push(rawStmt.stmt_location ?? 0)
    }
  }

  return locations
}

/**
 * Ensures the @libpg-query/parser WASM module is loaded.
 * Must be awaited once before any synchronous parseSync() calls.
 */
export function initSqlAst(
  importer: () => Promise<LibPgQuery> = () => import('@libpg-query/parser'),
): Promise<void> {
  return (moduleLoad ??= loadParser(importer)
    .then(async (loaded) => {
      await loaded.loadModule()
      parser = loaded
    })
    .catch((error) => {
      moduleLoad = undefined
      parser = undefined
      throw error
    }))
}

export function lineOfUtf8ByteOffset(content: string | Buffer, byteOffset: number): number {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  if (byteOffset > buffer.length) {
    throw new RangeError(
      `byteOffset ${byteOffset} is out of range for buffer length ${buffer.length}`,
    )
  }
  let line = 1
  for (let i = 0; i < byteOffset; i++) {
    if (buffer[i] === 10) line++
  }
  return line
}

function requireParser(): LibPgQuery {
  if (!parser) {
    throw new Error('initSqlAst() must be awaited before calling parse helpers')
  }
  return parser
}

async function loadParser(importer: () => Promise<LibPgQuery>): Promise<LibPgQuery> {
  try {
    return await importer()
  } catch (error) {
    if (isModuleNotFound(error)) throw new MissingSqlAstParserError()
    throw error
  }
}

function isModuleNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ERR_MODULE_NOT_FOUND'
  )
}
