import { astGrepPackPaths, type AstGrepPackPaths } from '../../ast-grep-pack/index.mts'

export function runAstGrepPackCommand(load: () => AstGrepPackPaths = astGrepPackPaths): number {
  try {
    process.stdout.write(`${JSON.stringify(load())}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
