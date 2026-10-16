import { randomBytes } from 'node:crypto'
import type { FeedbackEnvelope } from '../agent-blackboard/feedback-types.mts'

/** What a dry run validated: the redacted envelope and the scope its token is bound to. */
export type Preview = {
  sessionId: string
  parentSessionId: string | null
  mode: 'interactive' | 'autonomous'
  worktree: string
  sourceEventId: string
  envelope: FeedbackEnvelope
  warnings: string[]
}

export type PreviewScope = Omit<Preview, 'envelope' | 'warnings'>

const KEYS = ['sessionId', 'parentSessionId', 'mode', 'worktree', 'sourceEventId'] as const

/** In-memory, single-use preview tokens. A restarted server starts with none. */
export class PreviewRegistry {
  readonly #previews = new Map<string, Preview>()
  readonly #limit: number

  constructor(limit = 32) {
    this.#limit = limit
  }

  /** Stores a preview under a fresh 32-byte base64url token, evicting the oldest past the cap. */
  put(preview: Preview): string {
    const token = randomBytes(32).toString('base64url')
    this.restore(token, preview)
    return token
  }

  /** Removes and returns the preview, only when it is bound to exactly this scope. */
  take(token: string, scope: PreviewScope): Preview | undefined {
    const preview = this.#previews.get(token)
    // The scope is what the policy saw at preview time, so every field must match.
    if (preview === undefined || KEYS.some((key) => preview[key] !== scope[key])) return undefined
    this.#previews.delete(token)
    return preview
  }

  /** Stores a preview under a token (a taken one too), evicting the oldest past the cap. */
  restore(token: string, preview: Preview): void {
    this.#previews.set(token, preview)
    for (const oldest of this.#previews.keys()) {
      if (this.#previews.size <= this.#limit) break
      this.#previews.delete(oldest)
    }
  }

  clear(): void {
    this.#previews.clear()
  }
}

export const previewRegistry = new PreviewRegistry()
