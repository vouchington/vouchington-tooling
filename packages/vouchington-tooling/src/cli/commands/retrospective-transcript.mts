import { parseArgs } from 'node:util'
import {
  runRetrospectiveTranscript,
  type ResolveOptions,
} from '../../retrospective-transcript/index.mts'
import { isTimestamp } from '../../retrospective-transcript/window.mts'

export async function runRetrospectiveTranscriptCommand(args: string[]): Promise<number> {
  try {
    const { values } = parseArgs({
      args,
      strict: true,
      options: {
        'session-id': { type: 'string' },
        jsonl: { type: 'string' },
        'projects-dir': { type: 'string' },
        'codex-sessions-dir': { type: 'string' },
        'grok-sessions-dir': { type: 'string' },
        since: { type: 'string' },
        until: { type: 'string' },
      },
    })
    for (const key of ['since', 'until'] as const)
      if (values[key] !== undefined && !isTimestamp(values[key]))
        throw new Error(`--${key} must be an ISO 8601 timestamp`)
    const options: ResolveOptions = {
      ...(values['session-id'] ? { sessionId: values['session-id'] } : {}),
      ...(values.jsonl ? { jsonlPath: values.jsonl } : {}),
      ...(values['projects-dir'] ? { projectsDir: values['projects-dir'] } : {}),
      ...(values['codex-sessions-dir'] ? { codexSessionsDir: values['codex-sessions-dir'] } : {}),
      ...(values['grok-sessions-dir'] ? { grokSessionsDir: values['grok-sessions-dir'] } : {}),
      ...(values.since ? { since: values.since } : {}),
      ...(values.until ? { until: values.until } : {}),
      env: process.env,
    }
    process.stdout.write(await runRetrospectiveTranscript(options))
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}
