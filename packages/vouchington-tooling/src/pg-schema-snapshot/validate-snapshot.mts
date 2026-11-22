import type { SchemaSnapshot } from './types.mts'
import { createSnapshotValidation } from './validator-primitives.mts'
import { createTableValidator } from './validator-table.mts'
import type { ValidateSchemaSnapshotOptions } from './validator-types.mts'

export type SchemaSnapshotValidationResult =
  | { snapshot: SchemaSnapshot; errors: [] }
  | { snapshot: null; errors: string[] }

type Errors = string[]
type Fields = Record<string, unknown>

/**
 * Validates the complete v2 snapshot contract instead of trusting a JSON cast, so
 * static analysis fails closed on stale or malformed facts. Errors are
 * `::error file=<snapshotPath>::` workflow-command diagnostics.
 */
export function validateSchemaSnapshot(
  value: unknown,
  options: ValidateSchemaSnapshotOptions,
): SchemaSnapshotValidationResult {
  const v = createSnapshotValidation(options.snapshotPath)
  if (!v.isRecord(value)) {
    return { snapshot: null, errors: [v.diagnostic('snapshot must be an object')] }
  }
  const errors: Errors = []
  if (value.formatVersion !== 2) v.addError(errors, 'formatVersion must be 2')

  const object =
    (check: (e: Fields, p: string, errs: Errors) => void) =>
    (entry: unknown, path: string, errs: Errors): void => {
      if (!v.isRecord(entry)) return v.addError(errs, `${path} must be an object`)
      check(entry, path, errs)
    }
  const view = object((e, p, errs) => {
    v.validateString(e.definition, `${p}.definition`, errs)
    v.validateNullableString(e.comment, `${p}.comment`, errs)
    v.validateBoolean(e.materialized, `${p}.materialized`, errs)
  })
  const enumType = object((e, p, errs) => v.validateStringArray(e.values, `${p}.values`, errs))
  const extension = object((e, p, errs) => v.validateString(e.version, `${p}.version`, errs))
  const fn = object((e, p, errs) => v.validateString(e.definition, `${p}.definition`, errs))
  const policy = object((e, p, errs) => {
    v.validateString(e.table, `${p}.table`, errs)
    v.validateString(e.command, `${p}.command`, errs)
    v.validateStringArray(e.pgRoles, `${p}.pgRoles`, errs)
    v.validateNullableString(e.using, `${p}.using`, errs)
    v.validateNullableString(e.withCheck, `${p}.withCheck`, errs)
  })

  const table = createTableValidator(v, options.partitionPolicy ?? {})
  v.validateRecord(value.tables, 'tables', errors, table)
  v.validateRecord(value.views, 'views', errors, view)
  v.validateRecord(value.enums, 'enums', errors, enumType)
  v.validateRecord(value.extensions, 'extensions', errors, extension)
  v.validateRecord(value.functions, 'functions', errors, fn)
  v.validateRecord(value.policies, 'policies', errors, policy)
  return errors.length === 0
    ? { snapshot: value as SchemaSnapshot, errors: [] }
    : { snapshot: null, errors }
}
