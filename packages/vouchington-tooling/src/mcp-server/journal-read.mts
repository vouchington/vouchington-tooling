import { readJournal, type JournalLoader } from '../agent-blackboard/index.mts'
import type { BlackboardClientDependencies } from '../agent-blackboard/client.mts'

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (('status' in error && error.status === 404) ||
      ('statusCode' in error && error.statusCode === 404))
  )
}

/**
 * Every entry of the session through the server's own blackboard client, or undefined when the
 * session was never created (the blackboard answers 404). Any other failure is thrown.
 */
export async function readEntriesIfPresent(
  sessionId: string,
  env: NodeJS.ProcessEnv,
  dependencies: BlackboardClientDependencies,
): Promise<unknown[] | undefined> {
  try {
    return await readJournal(sessionId, env, dependencies)
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
}

/** The journal loader `composeRetrospective` takes, reading through the server's own client. */
export function serverJournalLoader(
  env: NodeJS.ProcessEnv,
  dependencies: BlackboardClientDependencies,
): JournalLoader {
  return async (sessionId) => {
    const entries = await readEntriesIfPresent(sessionId, env, dependencies)
    return entries === undefined
      ? { status: 'not-found' }
      : {
          status: 'ok',
          entries: entries as Array<{ data?: { type?: unknown; markdown?: unknown } }>,
        }
  }
}
