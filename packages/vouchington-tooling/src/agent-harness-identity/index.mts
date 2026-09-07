export const HARNESS_IDS = ['claude', 'codex', 'grok', 'cursor'] as const

export type HarnessId = (typeof HARNESS_IDS)[number]

export interface HarnessEnvironment {
  readonly claude: { readonly compatMode: boolean; readonly sessionId?: string }
  readonly codex: { readonly sessionId?: string }
  readonly cursor: { readonly agentMarker: boolean; readonly sessionId?: string }
  readonly grok: {
    readonly agentMarker: boolean
    readonly hookEvent: boolean
    readonly sessionId?: string
  }
}

export interface HarnessSessionIdentity {
  readonly harness: HarnessId
  readonly sessionId: string
}

function session(value: string | undefined): { readonly sessionId?: string } {
  return value ? { sessionId: value } : {}
}

export function inspectHarnessEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): HarnessEnvironment {
  return {
    claude: {
      compatMode: env.CLAUDECODE === '1',
      ...session(env.CLAUDE_CODE_SESSION_ID),
    },
    codex: session(env.CODEX_THREAD_ID),
    cursor: {
      agentMarker: Boolean(env.CURSOR_AGENT),
      ...session(env.CURSOR_SESSION_ID),
    },
    grok: {
      agentMarker: Boolean(env.GROK_AGENT),
      hookEvent: Boolean(env.GROK_HOOK_EVENT),
      ...session(env.GROK_SESSION_ID),
    },
  }
}

export function selectHarnessSession(
  environment: HarnessEnvironment,
  precedence: readonly HarnessId[],
): HarnessSessionIdentity | undefined {
  for (const harness of precedence) {
    const sessionId = environment[harness].sessionId
    if (sessionId) return { harness, sessionId }
  }
  return undefined
}
