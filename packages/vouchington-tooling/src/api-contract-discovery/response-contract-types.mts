import type { ExtractedResponseContract } from '../contract-schema/index.mts'

export type BackendResponseContract = ExtractedResponseContract & {
  method: string
  routeTemplate: string
  /** Statuses owned by this response emission. Defaults to 200, or 204 for an unannotated empty emission. */
  statusCodes?: readonly [number, ...number[]]
  /** Distinguishes a known framework default from an explicitly set or genuinely unknown status. */
  statusKnowledge?: 'default' | 'explicit' | 'unknown'
  bodyKind?: 'content' | 'none'
  /** Required for content emissions and absent for bodyless emissions. */
  mediaType?: string
  /** Raw buffers and arbitrary streams have an unknown media type; bodyless emissions have none. */
  mediaTypeKnowledge?: 'known' | 'none' | 'unknown'
  /** Named SSE frames carried by the string stream body. */
  sseEvents?: readonly { eventName: string; contract: ExtractedResponseContract }[]
  /** A concrete error status can also be produced by the framework before dispatch. */
  includeDefaultError?: boolean
  /** Set when the route's response schema could not be extracted (lenient discovery mode). */
  unavailableReason?: string
}
