import { parseArgs } from 'node:util'
import {
  runRetrospectiveTranscript,
  type ResolveOptions,
} from '../../retrospective-transcript/index.mts'

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
      },
    })
    const options: ResolveOptions = {
      ...(values['session-id'] ? { sessionId: values['session-id'] } : {}),
      ...(values.jsonl ? { jsonlPath: values.jsonl } : {}),
      ...(values['projects-dir'] ? { projectsDir: values['projects-dir'] } : {}),
      ...(values['codex-sessions-dir'] ? { codexSessionsDir: values['codex-sessions-dir'] } : {}),
      ...(values['grok-sessions-dir'] ? { grokSessionsDir: values['grok-sessions-dir'] } : {}),
      env: process.env,
    }
    process.stdout.write(await runRetrospectiveTranscript(options))
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}
