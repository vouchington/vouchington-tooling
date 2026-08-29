import { readFile } from 'node:fs/promises'
import { assertSessionId } from './session-id.mts'

export { cleanupSnapshotPartitions, partitionSnapshot } from './snapshot.mts'
export { assertSessionId } from './session-id.mts'
export type * from './snapshot-types.mts'

export type BlackboardConnection = {
  baseUrl: string
  token: string
  readRetry: Record<string, never>
}
type ClientModule = {
  Sessions: new (connection: BlackboardConnection) => {
    ensure(input: unknown): Promise<{ status: 'created' | 'exists' }>
    list(input: unknown): Promise<unknown>
    get(id: string): Promise<unknown>
  }
  Entries: new (connection: BlackboardConnection) => {
    append(input: unknown): Promise<{ createdAt: string }>
    get(input: unknown): AsyncIterable<unknown>
  }
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

export async function probeBlackboard(env?: NodeJS.ProcessEnv): Promise<void> {
  const { Sessions } = await loadClient()
  await new Sessions(resolveBlackboardConnection(env)).list({ limit: 1 })
}

export async function appendJournal(input: {
  sessionId: string
  agent: string
  version: string
  markdownFile: string
  parentSessionId?: string | null
  timestamp?: string
  env?: NodeJS.ProcessEnv
}): Promise<string> {
  assertSessionId(input.sessionId)
  let markdown: string
  try {
    markdown = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(input.markdownFile))
  } catch (error) {
    throw new Error(`note file is not valid UTF-8: ${input.markdownFile}`, { cause: error })
  }
  if (!markdown) throw new Error(`note file is empty: ${input.markdownFile}`)
  const connection = resolveBlackboardConnection(input.env)
  const { Sessions, Entries } = await loadClient()
  await new Sessions(connection).ensure({
    id: input.sessionId,
    parentSessionId: input.parentSessionId ?? null,
    agent: input.agent,
    version: input.version,
  })
  const entry = await new Entries(connection).append({
    sessionId: input.sessionId,
    data: { type: 'journal', markdown, timestamp: input.timestamp ?? new Date().toISOString() },
  })
  return `Journaled to agent-blackboard session ${input.sessionId} (entry created at ${entry.createdAt}).`
}

export async function readJournal(sessionId: string, env?: NodeJS.ProcessEnv): Promise<unknown[]> {
  assertSessionId(sessionId)
  const { Entries } = await loadClient()
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

async function loadClient(): Promise<ClientModule> {
  try {
    return (await import('agent-blackboard')) as ClientModule
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND')
      throw new Error(
        'agent-blackboard is not installed; install the optional agent-blackboard peer dependency',
        { cause: error },
      )
    throw error
  }
}
