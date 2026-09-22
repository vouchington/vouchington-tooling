import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertSessionId } from './session-id.mts'

export { cleanupSnapshotPartitions, partitionSnapshot } from './snapshot.mts'
export { assertSessionId } from './session-id.mts'
export type * from './snapshot-types.mts'

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

export async function probeBlackboard(
  env?: NodeJS.ProcessEnv,
  dependencies?: BlackboardClientDependencies,
): Promise<void> {
  const { Sessions } = await loadClient(dependencies)
  await new Sessions(resolveBlackboardConnection(env)).list({ limit: 1 })
}

export async function appendJournal(input: {
  sessionId: string
  agent: string
  version: string
  repositories: string[]
  markdownFile: string
  parentSessionId?: string | null
  timestamp?: string
  env?: NodeJS.ProcessEnv
  dependencies?: BlackboardClientDependencies
}): Promise<string> {
  assertSessionId(input.sessionId)
  if (input.parentSessionId != null) assertSessionId(input.parentSessionId, 'parent session id')
  const repositories = normalizeRepositories(input.repositories, true)
  const timestamp = input.timestamp === undefined ? new Date() : new Date(input.timestamp)
  if (Number.isNaN(timestamp.valueOf()))
    throw new Error('journal timestamp is not a valid date-time')
  let markdown: string
  try {
    markdown = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(input.markdownFile))
  } catch (error) {
    throw new Error(`note file is not valid UTF-8: ${input.markdownFile}`, { cause: error })
  }
  if (!markdown) throw new Error(`note file is empty: ${input.markdownFile}`)
  const connection = resolveBlackboardConnection(input.env)
  const { Sessions, Entries } = await loadClient(input.dependencies)
  const sessions = new Sessions(connection)
  const ensured = await sessions.ensure({
    id: input.sessionId,
    parentSessionId: input.parentSessionId ?? null,
    agent: input.agent,
    version: input.version,
  })
  if (ensured.session.archivedAt != null)
    throw new Error(`session is archived; create a new session: ${input.sessionId}`)
  const current = ensured.session.data.repositories
  const cumulative = normalizeRepositories(current, false)
  const merged = [...new Set([...cumulative, ...repositories])].sort()
  if (JSON.stringify(current) !== JSON.stringify(merged))
    await sessions.patch({ sessionId: input.sessionId, data: { repositories: merged } })
  const entry = await new Entries(connection).append({
    sessionId: input.sessionId,
    data: { type: 'journal', markdown, timestamp: timestamp.toISOString(), repositories },
  })
  return `Journaled to agent-blackboard session ${input.sessionId} (entry created at ${entry.createdAt}).`
}

function normalizeRepositories(value: unknown, required: boolean): string[] {
  if (value === undefined && !required) return []
  if (!Array.isArray(value) || (required && value.length === 0))
    throw new Error('repositories must be a non-empty array of owner/name strings')
  const repositories: string[] = []
  for (const candidate of value as unknown[]) {
    if (typeof candidate !== 'string')
      throw new Error('repositories must be a non-empty array of owner/name strings')
    const repository = candidate.trim().toLowerCase()
    if (!/^[a-z0-9-]+\/[a-z0-9._-]+$/.test(repository))
      throw new Error(`invalid repository: ${candidate}`)
    repositories.push(repository)
  }
  return [...new Set(repositories)].sort()
}

export async function readJournal(
  sessionId: string,
  env?: NodeJS.ProcessEnv,
  dependencies?: BlackboardClientDependencies,
): Promise<unknown[]> {
  assertSessionId(sessionId)
  const { Entries } = await loadClient(dependencies)
  const entries: unknown[] = []
  for await (const entry of new Entries(resolveBlackboardConnection(env)).get({
    sessionId,
    format: 'json',
  }))
    entries.push(entry)
  return entries
}

export function formatJournalEntries(sessionId: string, entries: unknown[]): string {
  const journals = entries.flatMap((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('createdAt' in entry) ||
      !('data' in entry) ||
      typeof entry.createdAt !== 'string' ||
      typeof entry.data !== 'object' ||
      entry.data === null ||
      !('type' in entry.data) ||
      !('markdown' in entry.data) ||
      entry.data.type !== 'journal' ||
      typeof entry.data.markdown !== 'string'
    )
      return []
    return [{ createdAt: entry.createdAt, markdown: entry.data.markdown }]
  })
  if (!journals.length) return `No journal entries found for session ${sessionId}.`
  return journals
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(({ createdAt, markdown }) => `## ${createdAt}\n\n${markdown}`)
    .join('\n\n')
}

async function loadClient(
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
