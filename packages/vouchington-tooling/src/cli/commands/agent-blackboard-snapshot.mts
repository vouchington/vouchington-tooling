import { cleanupSnapshotPartitions, partitionSnapshot } from '../../agent-blackboard/snapshot.mts'
import type {
  SnapshotCleanupReceipt,
  SnapshotCounts,
} from '../../agent-blackboard/snapshot-types.mts'
import { assertAllowed, flagsToValues, required } from './agent-blackboard-flags.mts'

export async function runSnapshot(args: string[]): Promise<number> {
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
