import {
  type ToolDefinition,
  IDEMPOTENT_ADDITIVE,
  MUTATING,
  READ_ONLY,
  tool,
} from './tools-schema.mts'

export const OUTBOX_TOOLS: readonly ToolDefinition[] = [
  tool(
    'outbox_status',
    'Reports unsent journal records in the worktree outbox. pendingCount and status (empty or ' +
      'pending) cover the caller sessionId only; worktreePendingCount covers every session. ' +
      'rejectedCount (and worktreeRejectedCount) counts permanently rejected records kept aside. ' +
      'failures lists each pending record that failed its last flush as sourceEventId, cause, ' +
      'optional httpStatus and code, and attempts; rejected lists each kept rejection with its ' +
      'stored diagnostic and cause. Causes are non-secret (network, timeout, http-5xx, ' +
      'http-4xx, missing-env:NAME, and similar), never a message, URL, or response body.',
    READ_ONLY,
  ),
  tool(
    'outbox_flush',
    'Delivers every retained record in the worktree outbox, whichever session wrote it, and ' +
      'returns deliveredCount for the whole flush. pendingCount and status cover the remaining ' +
      'records of the caller sessionId; worktreePendingCount covers every session. ' +
      'A record with a permanent rejection moves to the rejected area and is listed in rejected ' +
      'as sourceEventId, diagnostic, and cause. A record that fails delivery on a non-transient, ' +
      'record-specific cause (a 4xx other than 401, 403, 408, or 429, or an unexpected error) on 5 ' +
      'consecutive flushes is quarantined into the rejected area with diagnostic ' +
      'delivery-quarantined, so it no longer counts as pending. Network errors, timeouts, 5xx, ' +
      'credential and environment faults stay pending. failures lists each record that failed ' +
      'this flush as sourceEventId, cause (network, http-5xx, missing-env:NAME, and similar, ' +
      'never a message or URL), optional httpStatus and code, and attempts. diagnostic stays ' +
      'the summary of the flush.',
    IDEMPOTENT_ADDITIVE,
  ),
  tool(
    'outbox_prune_rejected',
    'Deletes rejected records (permanent rejections and quarantined records) from the worktree ' +
      'outbox that were last written at least olderThanDays days ago (default 7; 0 deletes ' +
      'all). Pending records are never touched. Returns prunedCount and the remaining counts.',
    MUTATING,
    {
      olderThanDays: {
        type: 'integer',
        minimum: 0,
        description: 'Minimum age in days of rejected records to delete (default 7).',
      },
    },
  ),
]
