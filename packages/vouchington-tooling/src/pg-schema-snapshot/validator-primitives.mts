export function createSnapshotValidation(schemaSnapshotPath: string) {
  const diagnostic = (message: string): string => {
    return `::error file=${schemaSnapshotPath}::${schemaSnapshotPath}: ${message}`
  }

  const addError = (errors: string[], message: string): void => {
    errors.push(diagnostic(message))
  }

  const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  const oneOf = (value: unknown, values: readonly string[]): boolean => {
    return typeof value === 'string' && values.includes(value)
  }

  const validateString = (value: unknown, path: string, errors: string[]): void => {
    if (typeof value !== 'string') addError(errors, `${path} must be a string`)
  }

  const validateNullableString = (value: unknown, path: string, errors: string[]): void => {
    if (value !== null && typeof value !== 'string')
      addError(errors, `${path} must be a string or null`)
  }

  const validateBoolean = (value: unknown, path: string, errors: string[]): void => {
    if (typeof value !== 'boolean') addError(errors, `${path} must be a boolean`)
  }

  const validateOneOf = (
    value: unknown,
    path: string,
    values: readonly string[],
    errors: string[],
  ): void => {
    if (!oneOf(value, values)) addError(errors, `${path} must be one of ${values.join(', ')}`)
  }

  const validateNullableOneOf = (
    value: unknown,
    path: string,
    values: readonly string[],
    errors: string[],
  ): void => {
    if (value !== null) validateOneOf(value, path, values, errors)
  }

  const validateRecord = (
    value: unknown,
    path: string,
    errors: string[],
    validateValue: (value: unknown, path: string, errors: string[]) => void,
  ): void => {
    if (!isRecord(value)) return addError(errors, `${path} must be an object`)
    for (const [key, entry] of Object.entries(value)) validateValue(entry, `${path}.${key}`, errors)
  }

  const validateStringRecord = (value: unknown, path: string, errors: string[]): void => {
    validateRecord(value, path, errors, validateString)
  }

  const validateArray = (
    value: unknown,
    path: string,
    errors: string[],
    validateValue: (value: unknown, path: string, errors: string[]) => void,
  ): void => {
    if (!Array.isArray(value)) return addError(errors, `${path} must be an array`)
    for (const [index, entry] of value.entries()) validateValue(entry, `${path}[${index}]`, errors)
  }

  const validateStringArray = (value: unknown, path: string, errors: string[]): void => {
    validateArray(value, path, errors, validateString)
  }

  const validateNullable = (
    value: unknown,
    path: string,
    errors: string[],
    validateValue: (value: unknown, path: string, errors: string[]) => void,
  ): void => {
    if (value !== null) validateValue(value, path, errors)
  }

  return {
    addError,
    diagnostic,
    isRecord,
    oneOf,
    validateArray,
    validateBoolean,
    validateNullable,
    validateNullableOneOf,
    validateNullableString,
    validateOneOf,
    validateRecord,
    validateString,
    validateStringArray,
    validateStringRecord,
  }
}
