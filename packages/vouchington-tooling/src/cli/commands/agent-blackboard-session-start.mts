import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { probeBlackboard } from '../../agent-blackboard/index.mts'
import { sessionStartContext, sessionStartOutput } from '../../agent-blackboard/session-start.mts'
import { assertAllowed, flagsToValues } from './agent-blackboard-flags.mts'

const execFileAsync = promisify(execFile)

async function insideWorkTree(): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'])
    return true
  } catch {
    return false
  }
}

async function readStdinPayload(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) return {}
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * SessionStart hook. Advisory only: it never exits nonzero for a probe or credential problem, so a
 * broken deployment cannot stop a session. Flag misuse still exits 2.
 */
export async function runSessionStart(args: string[]): Promise<number> {
  const values = flagsToValues(args)
  assertAllowed(values, ['skip-env', 'setup-hint', 'docs-path'])
  if (!(await insideWorkTree())) return 0
  const context = await sessionStartContext({
    payload: await readStdinPayload(),
    dependencies: { resolveFrom: import.meta.url },
    probe: probeBlackboard,
    ...(values['skip-env'] ? { skipEnv: values['skip-env'] } : {}),
    ...(values['setup-hint'] ? { setupHint: values['setup-hint'] } : {}),
    ...(values['docs-path'] ? { docsPath: values['docs-path'] } : {}),
  })
  if (context !== undefined) process.stdout.write(sessionStartOutput(context))
  return 0
}
