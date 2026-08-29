import {
  appendJournal,
  formatJournalEntries,
  probeBlackboard,
  readJournal,
} from '../../agent-blackboard/index.mts'
import { cleanupSnapshotPartitions, partitionSnapshot } from '../../agent-blackboard/snapshot.mts'
import type {
  SnapshotCleanupReceipt,
  SnapshotCounts,
} from '../../agent-blackboard/snapshot-types.mts'

let journalReader = readJournal

export function setJournalReaderForTest(reader?: typeof readJournal): void {
  journalReader = reader ?? readJournal
}

export async function runAgentBlackboardCommand(args: string[]): Promise<number> {
  try {
    const [command, ...rest] = args
    if (command === 'probe' && rest.length === 0) {
      await probeBlackboard()
      return 0
    }
    if (command === 'journal') return await runJournal(rest)
    if (command === 'snapshot') return await runSnapshot(rest)
    throw new Error(
      'usage: agent-blackboard probe | journal append|entries | snapshot partition|cleanup',
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
  const values = flagsToValues(flags)
  if (action === 'entries') {
    assertAllowed(values, ['session-id'])
    const sessionId = required(values, 'session-id')
    let entries: unknown[]
    try {
      entries = await journalReader(sessionId)
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
    ])
    process.stdout.write(
      `${await appendJournal({ sessionId: required(values, 'session-id'), agent: required(values, 'agent'), version: values.version ?? 'unknown', markdownFile: required(values, 'file'), ...(values['parent-session-id'] ? { parentSessionId: values['parent-session-id'] } : {}), ...('timestamp' in values ? { timestamp: values.timestamp } : {}) })}\n`,
    )
    return 0
  }
  throw new Error('usage: agent-blackboard journal append|entries')
}

function flagsToValues(flags: string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index]
    const value = flags[index + 1]
    if (!flag?.startsWith('--') || value === undefined)
      throw new Error(`invalid option: ${flag ?? ''}`)
    const key = flag.slice(2)
    if (key in values) throw new Error(`duplicate option: ${flag}`)
    values[key] = value
  }
  return values
}
function assertAllowed(values: Record<string, string>, allowed: string[]): void {
  for (const key of Object.keys(values))
    if (!allowed.includes(key)) throw new Error(`unknown option: --${key}`)
}
function required(values: Record<string, string>, key: string): string {
  const value = values[key]
  if (!value) throw new Error(`--${key} is required`)
  return value
}
function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (('status' in error && error.status === 404) ||
      ('statusCode' in error && error.statusCode === 404))
  )
}
