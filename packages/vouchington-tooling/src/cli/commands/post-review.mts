import { runPostReviewCli } from '../../gha-post-review/cli.mts'

export function runPostReviewCommand(): Promise<number> {
  return runPostReviewCli()
}
