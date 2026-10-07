import {
  assertAllowed,
  flagsToValues,
  required,
  validatedSessionId,
} from './agent-blackboard-flags.mts'
import {
  appendJournal,
  feedbackOutboxCounts,
  flushFeedbackOutbox,
  formatJournalEntries,
  probeBlackboard,
  readJournal,
  type FeedbackMode,
  type WorkOutcome,
  type FeedbackCoverage,
} from '../../agent-blackboard/index.mts'
import { cleanupSnapshotPartitions, partitionSnapshot } from '../../agent-blackboard/snapshot.mts'
import type {
  SnapshotCleanupReceipt,
  SnapshotCounts,
} from '../../agent-blackboard/snapshot-types.mts'

const dependencies = { resolveFrom: import.meta.url }
let journalReader = readJournal

export function setJournalReaderForTest(reader?: typeof readJournal): void {
  journalReader = reader ?? readJournal
}

export async function runAgentBlackboardCommand(args: string[]): Promise<number> {
  try {
    const [command, ...rest] = args
    if (command === 'probe' && rest.length === 0) {
      await probeBlackboard(undefined, dependencies)
      return 0
    }
    if (command === 'journal') return await runJournal(rest)
    if (command === 'snapshot') return await runSnapshot(rest)
    throw new Error(
      'usage: agent-blackboard probe | journal append|entries|flush|status | snapshot partition|cleanup',
    )
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}

async function runSnapshot(args: string[]): Promise<number> {
  const [action, ...flags] = args
  const values = flagsToValues(flags)
  if (action === 'cleanup') {
    assertAllowed(values, ['snapshot', 'partition-directory', 'receipt'])
    if (values['partition-directory'] && !values.receipt)
      throw new Error('--receipt is required with --partition-directory')
    await cleanupSnapshotPartitions({
      ...(values.snapshot ? { path: values.snapshot } : {}),
      ...(values['partition-directory'] ? { directory: values['partition-directory'] } : {}),
      ...(values.receipt ? { receipt: JSON.parse(values.receipt) as SnapshotCleanupReceipt } : {}),
    })
    process.stdout.write('{"cleaned":true}\n')
    return 0
  }
  if (action === 'partition') {
    assertAllowed(values, ['snapshot', 'checksum', 'counts'])
    const counts = JSON.parse(required(values, 'counts')) as SnapshotCounts
    process.stdout.write(
      `${JSON.stringify(
        await partitionSnapshot({
          path: required(values, 'snapshot'),
          checksum: { algorithm: 'sha256', value: required(values, 'checksum') },
          counts,
        }),
      )}\n`,
    )
    return 0
  }
  throw new Error('usage: agent-blackboard snapshot partition|cleanup')
}

async function runJournal(args: string[]): Promise<number> {
  const [action, ...flags] = args
  const { repositories, remaining } =
    action === 'append' ? extractRepositories(flags) : { repositories: [], remaining: flags }
  const values = flagsToValues(remaining)
  if (action === 'flush' || action === 'status') {
    assertAllowed(values, ['outbox-directory', 'session-id'])
    const directory = required(values, 'outbox-directory')
    const sessionId = validatedSessionId(
      action === 'status' ? required(values, 'session-id') : values['session-id'],
    )
    const result =
      action === 'flush'
        ? await flushFeedbackOutbox({ directory, dependencies })
        : { pendingCount: 0 }
    const counts = sessionId !== undefined ? feedbackOutboxCounts(directory, sessionId) : result
    process.stdout.write(
      `${JSON.stringify({
        ...result,
        ...counts,
        sessionId,
        status: counts.pendingCount ? 'pending' : 'empty',
      })}\n`,
    )
    return 0
  }
  if (action === 'entries') {
    assertAllowed(values, ['session-id'])
    const sessionId = required(values, 'session-id')
    let entries: unknown[]
    try {
      entries = await journalReader(sessionId, undefined, dependencies)
    } catch (error) {
      if (!isNotFound(error)) throw error
      entries = []
    }
    process.stdout.write(`${formatJournalEntries(sessionId, entries)}\n`)
    return 0
  }
  if (action === 'append') {
    assertAllowed(values, [
      'session-id',
      'agent',
      'version',
      'file',
      'parent-session-id',
      'timestamp',
      'mode',
      'source-event-id',
      'work-outcome',
      'coverage-status',
      'coverage-source',
      'dropped-count',
      'outbox-directory',
    ])
    const result = await appendJournal({
      dependencies,
      mode: required(values, 'mode') as FeedbackMode,
      sourceEventId: required(values, 'source-event-id'),
      workOutcome: required(values, 'work-outcome') as WorkOutcome,
      feedbackCoverage: {
        status: required(values, 'coverage-status') as FeedbackCoverage['status'],
        sources: values['coverage-source']?.split(',') ?? [],
        droppedCount: Number(values['dropped-count'] ?? '0'),
      },
      ...(values['outbox-directory'] ? { outboxDirectory: values['outbox-directory'] } : {}),
      sessionId: required(values, 'session-id'),
      agent: required(values, 'agent'),
      version: values.version ?? 'unknown',
      repositories: requiredRepositories(repositories),
      markdownFile: required(values, 'file'),
      ...('timestamp' in values ? { timestamp: values.timestamp } : {}),
      parentSessionId: values['parent-session-id'] ?? null,
    })
    // Autonomous mode has no outbox, so its receipt must not depend on one.
    const counts =
      values.mode === 'autonomous'
        ? { pendingCount: 0, worktreePendingCount: 0 }
        : pendingCounts(required(values, 'outbox-directory'), required(values, 'session-id'))
    const storedVersion = result.status === 'delivered' ? result.receipt.storedVersion : undefined
    // JSON.stringify drops an undefined `storedVersion`.
    process.stdout.write(`${JSON.stringify({ ...result, storedVersion, ...counts })}\n`)
    return 0
  }
  throw new Error('usage: agent-blackboard journal append|entries|flush|status')
}

function extractRepositories(flags: string[]): { repositories: string[]; remaining: string[] } {
  const repositories: string[] = []
  const remaining: string[] = []
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index]
    const value = flags[index + 1]
    if (!flag?.startsWith('--') || value === undefined)
      throw new Error(`invalid option: ${flag ?? ''}`)
    if (flag === '--repository') repositories.push(value)
    else remaining.push(flag, value)
  }
  return { repositories, remaining }
}

function requiredRepositories(repositories: string[]): string[] {
  if (repositories.length === 0) throw new Error('--repository is required')
  return repositories
}

/** An append receipt reports only unsent records; rejected records are not pending. */
function pendingCounts(directory: string, sessionId: string) {
  const { pendingCount, worktreePendingCount } = feedbackOutboxCounts(directory, sessionId)
  return { pendingCount, worktreePendingCount }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (('status' in error && error.status === 404) ||
      ('statusCode' in error && error.statusCode === 404))
  )
}
