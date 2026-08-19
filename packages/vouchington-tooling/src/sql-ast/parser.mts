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

/**
 * Ensures the @libpg-query/parser WASM module is loaded.
 * Must be awaited once before any synchronous parseSql() calls.
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

export function parseSql(content: string): ReturnType<LibPgQuery['parseSync']> {
  if (!parser) {
    throw new Error('initSqlAst() must be awaited before calling parse helpers')
  }
  return parser.parseSync(content)
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
