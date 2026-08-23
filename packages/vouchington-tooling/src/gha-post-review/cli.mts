import { fileURLToPath } from 'node:url'

import { writePostedOutput, postReviewFromEnv } from './github.mts'

export async function runPostReviewCli(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  try {
    const result = await postReviewFromEnv(env)
    writePostedOutput(result.posted, env.GITHUB_OUTPUT)
    return 0
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

/* v8 ignore next 12 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPostReviewCli().then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    },
  )
}
