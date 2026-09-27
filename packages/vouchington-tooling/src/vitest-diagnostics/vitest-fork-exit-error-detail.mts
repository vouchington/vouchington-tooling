// Split out of vitest-fork-exit-sentinel.mts to keep that file under the repo's 200-line cap —
// mirrors vitest-worker-exit-diagnostics-errors.mts's split from the reporter file next door.
//
// Node's own --report-uncaught-exception mechanism can never fire for mode=uncaught: it only
// auto-writes a report when an exception would otherwise reach Node's default handler, and
// registering vitest-fork-exit-sentinel.mts's uncaughtException listener is exactly what prevents
// that (verified empirically). This module is the one place in
// the pipeline that still has the real error, before ChildProcess.emitUnexpectedExit's
// no-parameters handler in vitest's own pool throws it away — see that file's header comment.
const MAX_INLINE_ERROR_MESSAGE_CHARS = 200
export const MAX_RECORDED_ERROR_STACK_CHARS = 4000

export interface ForkExitErrorDetail {
  message: string
  stack: string | undefined
}

export function toErrorDetail(error: unknown): ForkExitErrorDetail {
  if (error instanceof Error) {
    return {
      message: typeof error.message === 'string' ? error.message : String(error.message),
      stack: typeof error.stack === 'string' ? error.stack : undefined,
    }
  }
  return { message: String(error), stack: undefined }
}

// Collapses to one line and bounds length so the sentinel's fd-2 write stays the single
// synchronous line its module header comment guarantees, regardless of how many lines or how long
// the real message is.
export function sanitizeInlineErrorMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, MAX_INLINE_ERROR_MESSAGE_CHARS)
}
