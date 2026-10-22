import { runSnapshot } from './agent-blackboard-snapshot.mts'
import { runSessionStart } from './agent-blackboard-session-start.mts'
import { probeBlackboard } from '../../agent-blackboard/index.mts'
import { runDistillClassify } from '../../retrospective-distill/index.mts'

const dependencies = { resolveFrom: import.meta.url }

export async function runAgentBlackboardCommand(args: string[]): Promise<number> {
  try {
    const [command, ...rest] = args
    if (command === 'probe' && rest.length === 0) {
      await probeBlackboard(undefined, dependencies)
      return 0
    }
    if (command === 'snapshot') return await runSnapshot(rest)
    if (command === 'session-start') return await runSessionStart(rest)
    if (command === 'distill' && rest[0] === 'classify') {
      process.stdout.write(`${await runDistillClassify(rest.slice(1))}\n`)
      return 0
    }
    throw new Error(
      'usage: agent-blackboard probe | session-start | distill classify | snapshot partition|cleanup',
    )
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}
