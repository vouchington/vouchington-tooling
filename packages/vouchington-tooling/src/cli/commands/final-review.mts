import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import {
  createGhFinalReviewIo,
  finalReviewStatus,
  parseFinalReviewInput,
  numberDiff,
  postFinalReview,
  revokeFinalApproval,
  type FinalReviewIo,
  type PullTarget,
} from '../../final-review/index.mts'

export type FinalReviewDeps = {
  createIo(target: PullTarget): FinalReviewIo
  readFile(path: string): string
  runBench(args: string[]): Promise<number>
}

const defaultDeps: FinalReviewDeps = {
  createIo: (target) => createGhFinalReviewIo(target),
  readFile: (path) => readFileSync(path, 'utf8'),
  runBench: async (args) =>
    (await import('../../final-review/benchmark/cli.mts')).runFinalReviewBenchCli(args),
}

function target(values: { repo?: string; pr?: string }): PullTarget {
  if (values.repo === undefined || values.pr === undefined)
    throw new Error('--repo and --pr are required.')
  return { repo: values.repo, pr: Number(values.pr) }
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function run(
  subcommand: string | undefined,
  args: string[],
  deps: FinalReviewDeps,
): Promise<number> {
  if (subcommand === 'bench') return deps.runBench(args)
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      repo: { type: 'string' },
      pr: { type: 'string' },
      'head-sha': { type: 'string' },
      input: { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
  })
  const io = deps.createIo(target(values))
  switch (subcommand) {
    case 'post': {
      if (values['head-sha'] === undefined || values.input === undefined) {
        throw new Error('post needs --head-sha and --input.')
      }
      const input = parseFinalReviewInput(JSON.parse(deps.readFile(values.input)) as unknown)
      const outcome = await postFinalReview(io, input, values['head-sha'], {
        dryRun: values['dry-run'] === true,
      })
      print(values['dry-run'] === true ? outcome : { ...outcome, reviews: outcome.reviews.length })
      return 0
    }
    case 'diff':
      process.stdout.write(numberDiff(await io.diff()))
      return 0
    case 'revoke':
      print({ removed: await revokeFinalApproval(io) })
      return 0
    case 'status': {
      const status = await finalReviewStatus(io)
      print(status)
      return status.approved ? 0 : 1
    }
    default:
      throw new Error('final-review needs post, diff, revoke, status, or bench.')
  }
}

export async function runFinalReviewCommand(
  args: string[],
  deps: FinalReviewDeps = defaultDeps,
): Promise<number> {
  try {
    return await run(args[0], args.slice(1), deps)
  } catch (error) {
    process.stderr.write(
      `final-review: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 2
  }
}
