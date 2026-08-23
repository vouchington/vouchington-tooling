import { fileURLToPath } from 'node:url'

import { ReviewPayloadError } from './payload.mts'
import { stageReviewPayload, writeStagedOutput } from './file.mts'

export function runStageReviewPayloadCli(args: readonly string[]): number {
  try {
    const [requirement, source, destination] = args
    if (requirement !== 'optional' && requirement !== 'required') {
      throw new ReviewPayloadError('payload requirement must be optional or required.')
    }
    if (!source || !destination || args.length !== 3) {
      throw new ReviewPayloadError(
        'Usage: vouchington stage-review-payload optional|required <source> <destination>',
      )
    }
    writeStagedOutput(
      'staged',
      stageReviewPayload(source, destination, requirement) ? 'true' : 'false',
    )
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

/* v8 ignore next 3 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runStageReviewPayloadCli(process.argv.slice(2))
}
