import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { validateSchemaSnapshot } from './validate-snapshot.mts'
import type { SchemaSnapshotValidationResult } from './validate-snapshot.mts'
import type { ValidateSchemaSnapshotOptions } from './validator-types.mts'

export type LoadSchemaSnapshotOptions = ValidateSchemaSnapshotOptions & {
  repoRoot: string
  /** Repository-relative paths of tracked files; the snapshot must be among them. */
  trackedFiles: ReadonlySet<string>
  /** Already-parsed snapshot for isolated fixtures; skips the tracked-file check and read. */
  snapshot?: unknown
}

export function loadSchemaSnapshot(
  options: LoadSchemaSnapshotOptions,
): SchemaSnapshotValidationResult {
  const { snapshotPath } = options
  let value = options.snapshot
  if (value === undefined) {
    if (!options.trackedFiles.has(snapshotPath)) {
      return failed(snapshotPath, 'generated PostgreSQL schema snapshot must be tracked')
    }
    try {
      value = JSON.parse(readFileSync(join(options.repoRoot, snapshotPath), 'utf8'))
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return failed(snapshotPath, `could not read valid JSON (${reason})`)
    }
  }
  return validateSchemaSnapshot(value, options)
}

function failed(snapshotPath: string, message: string): SchemaSnapshotValidationResult {
  return {
    snapshot: null,
    errors: [`::error file=${snapshotPath}::${snapshotPath}: ${message}`],
  }
}
