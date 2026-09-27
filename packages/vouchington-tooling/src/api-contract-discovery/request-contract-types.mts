import type { ExtractedResponseContract } from '../contract-schema/index.mts'

/**
 * A backend route's request-body contract. Mirrors `BackendResponseContract` minus the
 * status/variant concepts responses have — a request has no status code and (unlike a response)
 * no `#variant` escape hatch, so every route resolves to at most one `BackendRequestContract`.
 */
export type BackendRequestContract = ExtractedResponseContract & {
  method: string
  routeTemplate: string
  /** Set when the route's request schema could not be extracted (lenient discovery mode), or the route reads a raw non-JSON buffer body. */
  unavailableReason?: string
}
