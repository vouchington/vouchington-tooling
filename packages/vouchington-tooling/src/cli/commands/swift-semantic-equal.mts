import { runSwiftSemanticEqualCli } from '../../swift-semantic-equal/cli.mts'

export function runSwiftSemanticEqualCommand(args: readonly string[]): number {
  return runSwiftSemanticEqualCli(args)
}
