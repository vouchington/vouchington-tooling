import { runAstGrepExamples } from '../../ast-grep-examples/index.mts'

export function runAstGrepExamplesCommand(options: { rules: string; config: string }): number {
  return runAstGrepExamples(options)
}
