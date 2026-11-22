import type { createSnapshotValidation } from './validator-primitives.mts'
import type { PartitionPolicyOptions } from './validator-types.mts'

type Validation = ReturnType<typeof createSnapshotValidation>
type Errors = string[]

const referentialActions = ['no action', 'restrict', 'cascade', 'set null', 'set default'] as const

export function createTableValidator(v: Validation, policy: PartitionPolicyOptions) {
  const column = (value: unknown, path: string, errors: Errors): void => {
    if (!v.isRecord(value)) return v.addError(errors, `${path} must be an object`)
    v.validateString(value.type, `${path}.type`, errors)
    v.validateBoolean(value.nullable, `${path}.nullable`, errors)
    v.validateNullableString(value.defaultExpression, `${path}.defaultExpression`, errors)
    v.validateNullableString(value.generatedExpression, `${path}.generatedExpression`, errors)
    v.validateNullableOneOf(value.identity, `${path}.identity`, ['always', 'by default'], errors)
    v.validateNullableOneOf(value.generated, `${path}.generated`, ['stored', 'virtual'], errors)
    v.validateNullableString(value.collation, `${path}.collation`, errors)
    v.validateNullableString(value.comment, `${path}.comment`, errors)
    if (!Number.isInteger(value.ordinalPosition)) {
      v.addError(errors, `${path}.ordinalPosition must be an integer`)
    }
  }

  const keyConstraint = (value: unknown, path: string, errors: Errors): void => {
    if (!v.isRecord(value)) return v.addError(errors, `${path} must be an object`)
    v.validateString(value.definition, `${path}.definition`, errors)
    v.validateStringArray(value.columns, `${path}.columns`, errors)
  }

  const foreignKey = (value: unknown, path: string, errors: Errors): void => {
    keyConstraint(value, path, errors)
    if (!v.isRecord(value)) return
    v.validateString(value.referencedTable, `${path}.referencedTable`, errors)
    v.validateStringArray(value.referencedColumns, `${path}.referencedColumns`, errors)
    v.validateOneOf(value.onUpdate, `${path}.onUpdate`, referentialActions, errors)
    v.validateOneOf(value.onDelete, `${path}.onDelete`, referentialActions, errors)
    v.validateBoolean(value.validated, `${path}.validated`, errors)
  }

  const indexKey = (value: unknown, path: string, errors: Errors): void => {
    if (!v.isRecord(value)) return v.addError(errors, `${path} must be an object`)
    v.validateNullableString(value.column, `${path}.column`, errors)
    v.validateString(value.expression, `${path}.expression`, errors)
    v.validateString(value.opclass, `${path}.opclass`, errors)
    v.validateBoolean(value.descending, `${path}.descending`, errors)
    v.validateBoolean(value.nullsFirst, `${path}.nullsFirst`, errors)
  }

  const index = (value: unknown, path: string, errors: Errors): void => {
    if (!v.isRecord(value)) return v.addError(errors, `${path} must be an object`)
    v.validateString(value.definition, `${path}.definition`, errors)
    v.validateString(value.accessMethod, `${path}.accessMethod`, errors)
    for (const flag of ['unique', 'primary', 'constraintBacked', 'valid', 'ready']) {
      v.validateBoolean(value[flag], `${path}.${flag}`, errors)
    }
    v.validateArray(value.keys, `${path}.keys`, errors, indexKey)
    v.validateStringArray(value.includedColumns, `${path}.includedColumns`, errors)
    v.validateNullableString(value.predicate, `${path}.predicate`, errors)
  }

  const physicalPartition = (value: unknown, path: string, errors: Errors): void => {
    if (!v.isRecord(value)) return v.addError(errors, `${path} must be an object`)
    v.validateOneOf(value.strategy, `${path}.strategy`, ['hash', 'list', 'range'], errors)
    v.validateString(value.key, `${path}.key`, errors)
  }

  const partitionPolicy = (value: unknown, path: string, errors: Errors): void => {
    if (!v.isRecord(value)) return v.addError(errors, `${path} must be an object`)
    v.validateOneOf(
      value.strategy,
      `${path}.strategy`,
      policy.strategies ?? ['RANGE', 'LIST -> RANGE'],
      errors,
    )
    v.validateString(value.key, `${path}.key`, errors)
    v.validateOneOf(
      value.children,
      `${path}.children`,
      policy.children ?? ['default', 'monthly', 'list-default-range'],
      errors,
    )
    if (policy.retentionOwners) {
      v.validateNullableOneOf(
        value.retentionOwner,
        `${path}.retentionOwner`,
        policy.retentionOwners,
        errors,
      )
    } else {
      v.validateNullableString(value.retentionOwner, `${path}.retentionOwner`, errors)
    }
    if (policy.accessClasses) {
      v.validateOneOf(value.accessClass, `${path}.accessClass`, policy.accessClasses, errors)
    } else {
      v.validateString(value.accessClass, `${path}.accessClass`, errors)
    }
  }

  return (value: unknown, path: string, errors: Errors): void => {
    if (!v.isRecord(value)) return v.addError(errors, `${path} must be an object`)
    if (!v.oneOf(value.relationKind, ['table', 'partitioned table'])) {
      v.addError(errors, `${path}.relationKind must be table or partitioned table`)
    }
    v.validateRecord(value.columns, `${path}.columns`, errors, column)
    v.validateNullable(value.primaryKey, `${path}.primaryKey`, errors, keyConstraint)
    v.validateRecord(value.uniqueConstraints, `${path}.uniqueConstraints`, errors, keyConstraint)
    v.validateStringRecord(value.checkConstraints, `${path}.checkConstraints`, errors)
    v.validateRecord(value.foreignKeys, `${path}.foreignKeys`, errors, foreignKey)
    v.validateRecord(value.indexes, `${path}.indexes`, errors, index)
    v.validateStringRecord(value.triggers, `${path}.triggers`, errors)
    v.validateNullableString(value.comment, `${path}.comment`, errors)
    v.validateNullable(
      value.physicalPartition,
      `${path}.physicalPartition`,
      errors,
      physicalPartition,
    )
    v.validateNullable(value.partition, `${path}.partition`, errors, partitionPolicy)
    if (!v.oneOf(value.growth, ['bounded', 'unbounded'])) {
      v.addError(errors, `${path}.growth must be bounded or unbounded`)
    }
  }
}
