export { classifyFrictionObservation } from './classify.mts'
export { normalizeCommandPrefix } from './normalize.mts'
export { FRICTION_LOG_MAX_EVENTS, readFrictionLog, recordFriction } from './log.mts'
export { buildSessionFrictionReport } from './report.mts'
export { isConformingCiFailureBlock } from './ci-failures.mts'
export type {
  FrictionEvent,
  FrictionEventKind,
  FrictionLogOptions,
  FrictionLogReadResult,
  FrictionObservation,
  JournalEntry,
  JournalLoadResult,
  JournalLoader,
  PermissionRequestObservation,
  SessionFrictionReport,
  SessionFrictionReportOptions,
  ToolResultObservation,
} from './types.mts'
