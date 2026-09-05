import { astGrepPackPaths } from '../../ast-grep-pack/index.mts'

export function runAstGrepPackCommand(): number {
  try {
    process.stdout.write(`${JSON.stringify(astGrepPackPaths())}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
