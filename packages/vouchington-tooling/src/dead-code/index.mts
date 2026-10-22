export { runDeadCodeCli, USAGE } from './cli.mts'
export { runDeadCodeGate } from './gate.mts'
export type { DeadCodeGateOptions, DeadCodeGateResult, DeadCodeOperation } from './gate.mts'
export {
  compareRows,
  parseBaseline,
  readBaseline,
  reconcileBaseline,
  rowsFromReport,
  writeBaseline,
} from './baseline.mts'
export type { BaselineRow, FindingIdentity } from './baseline.mts'
export { resolveEntryRoots } from './entry-roots.mts'
export { createFindingFilter, scanDeadCode } from './scan.mts'
export { copyTrackedWorkingTree, trackedPaths } from './tracked-snapshot.mts'
export { ChildCommandCleanupError, runChildCommand } from './child-command.mts'
