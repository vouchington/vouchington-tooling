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
        pr: { type: 'string' },
        branch: { type: 'string' },
        'no-pr': { type: 'boolean' },
        repo: { type: 'string' },
        raw: { type: 'boolean' },
      },
    })
    const options: RetrospectiveFactsOptions = {
      ...(values.pr === undefined ? {} : { pr: values.pr }),
      ...(values.branch === undefined ? {} : { branch: values.branch }),
      ...(values['no-pr'] === undefined ? {} : { noPr: values['no-pr'] }),
      ...(values.repo === undefined ? {} : { repo: values.repo }),
      ...(values.raw ? { raw: true } : {}),
    }
    process.stdout.write(
      await runRetrospectiveFacts({
        ...options,
        onWarning: (message) => process.stderr.write(`${message}\n`),
      }),
    )
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}
