import { validateOptionalHttpOrigin } from '../../http-origin/index.mts'

export function runHttpOrigin(field: string, value: string): number {
  try {
    validateOptionalHttpOrigin(value, field)
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
