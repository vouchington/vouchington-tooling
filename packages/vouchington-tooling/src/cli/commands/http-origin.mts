import { validateOptionalHttpOrigin } from '../../http-origin/index.mts'

export function formatCliError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function runHttpOrigin(field: string, value: string): number {
  try {
    validateOptionalHttpOrigin(value, field)
    return 0
  } catch (error) {
    process.stderr.write(`${formatCliError(error)}\n`)
    return 1
  }
}
