import { randomBytes } from 'node:crypto'
import type { FeedbackEnvelope } from '../agent-blackboard/feedback-types.mts'

/** What a dry run validated: the redacted envelope and the scope its token is bound to. */
export type Preview = {
  sessionId: string
  worktree: string
  sourceEventId: string
  envelope: FeedbackEnvelope
  warnings: string[]
}

export type PreviewScope = Pick<Preview, 'sessionId' | 'worktree' | 'sourceEventId'>

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
    this.#previews.set(token, preview)
    for (const oldest of this.#previews.keys()) {
      if (this.#previews.size <= this.#limit) break
      this.#previews.delete(oldest)
    }
    return token
  }

  /** Removes and returns the preview, only when it is bound to exactly this scope. */
  take(token: string, scope: PreviewScope): Preview | undefined {
    const preview = this.#previews.get(token)
    if (
      preview === undefined ||
      preview.sessionId !== scope.sessionId ||
      preview.worktree !== scope.worktree ||
      preview.sourceEventId !== scope.sourceEventId
    )
      return undefined
    this.#previews.delete(token)
    return preview
  }

  /** Puts a taken preview back, so a save that failed to write can be retried. */
  restore(token: string, preview: Preview): void {
    this.#previews.set(token, preview)
  }

  clear(): void {
    this.#previews.clear()
  }
}

export const previewRegistry = new PreviewRegistry()
