import { runStageReviewPayloadCli } from '../../gha-review-payload/cli.mts'

export function runStageReviewPayloadCommand(args: readonly string[]): number {
  return runStageReviewPayloadCli(args)
}
