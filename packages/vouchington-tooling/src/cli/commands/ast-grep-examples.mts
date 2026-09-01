import { runAstGrepExamples } from '../../ast-grep-examples/index.mts'

export function runAstGrepExamplesCommand(options: { rules: string; config: string }): number {
  try {
    return runAstGrepExamples(options)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
