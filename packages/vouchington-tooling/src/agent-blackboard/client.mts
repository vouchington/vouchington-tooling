import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
export type BlackboardConnection = {
  baseUrl: string
  token: string
  readRetry: Record<string, never>
}
export type BlackboardClientModule = {
  Sessions: new (connection: BlackboardConnection) => {
    ensure(input: unknown): Promise<{
      status: 'created' | 'exists'
      session: { data: Record<string, unknown>; archivedAt?: string | null }
    }>
    patch(input: unknown): Promise<unknown>
    list(input: unknown): Promise<unknown>
    get(id: string): Promise<unknown>
  }
  Entries: new (connection: BlackboardConnection) => {
    append(input: unknown): Promise<{ createdAt: string }>
    get(input: unknown): AsyncIterable<unknown>
  }
}
type BlackboardClientLoader = () => Promise<BlackboardClientModule>
export type BlackboardClientDependencies = {
  loadClient?: BlackboardClientLoader
  resolveFrom?: string | URL
}

export function resolveBlackboardConnection(
  env: NodeJS.ProcessEnv = process.env,
): BlackboardConnection {
  const baseUrl = env.AGENT_BLACKBOARD_URL
  const token = env.AGENT_BLACKBOARD_TOKEN
  if (!baseUrl) throw new Error('AGENT_BLACKBOARD_URL is not set')
  if (!token) throw new Error('AGENT_BLACKBOARD_TOKEN is not set')
  return { baseUrl, token, readRetry: {} }
}

export async function loadClient(
  dependencies: BlackboardClientDependencies = {},
): Promise<BlackboardClientModule> {
  const loader = dependencies.loadClient ?? (() => defaultClientLoader(dependencies.resolveFrom))
  try {
    return await loader()
  } catch (error) {
    if (isMissingModuleError(error))
      throw new Error(
        'agent-blackboard is not installed; install it alongside vouchington-tooling to use this integration',
        { cause: error },
      )
    throw error
  }
}

async function defaultClientLoader(resolveFrom?: string | URL): Promise<BlackboardClientModule> {
  const consumerRequire = createRequire(resolveFrom ?? resolve(process.cwd(), 'package.json'))
  const specifier = pathToFileURL(consumerRequire.resolve('agent-blackboard')).href
  return (await import(specifier)) as BlackboardClientModule
}

function isMissingModuleError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND')
  )
}
