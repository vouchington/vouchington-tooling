import { parseArgs } from 'node:util'
import {
  runRetrospectiveFacts,
  type RetrospectiveFactsOptions,
} from '../../retrospective-facts/index.mts'

export async function runRetrospectiveFactsCommand(args: string[]): Promise<number> {
  try {
    const { values } = parseArgs({
      args,
      strict: true,
      options: {
        pr: { type: 'string', multiple: true },
        branch: { type: 'string' },
        'no-pr': { type: 'boolean' },
        repo: { type: 'string' },
        raw: { type: 'boolean' },
      },
    })
    const prs = values.pr ?? []
    const shared: Omit<RetrospectiveFactsOptions, 'pr' | 'onWarning' | 'execute'> = {
      ...(values.branch === undefined ? {} : { branch: values.branch }),
      ...(values['no-pr'] === undefined ? {} : { noPr: values['no-pr'] }),
      ...(values.repo === undefined ? {} : { repo: values.repo }),
      ...(values.raw ? { raw: true } : {}),
    }
    const selectors = prs.length === 0 ? [undefined] : prs
    const blocks: string[] = []
    for (const pr of selectors) {
      blocks.push(
        await runRetrospectiveFacts({
          ...shared,
          ...(pr === undefined ? {} : { pr }),
          onWarning: (message) => process.stderr.write(`${message}\n`),
        }),
      )
    }
    if (blocks.length === 1) {
      process.stdout.write(blocks[0]!)
      return 0
    }
    process.stdout.write(`${joinFactBlocks(blocks)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}

function joinFactBlocks(blocks: readonly string[]): string {
  return blocks.map((block) => block.replace(/\n+$/, '')).join('\n\n')
}
