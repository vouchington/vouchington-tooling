import { shell } from './exec.mts'
import { foreignFacts } from './foreign.mts'
import { localFacts } from './local.mts'
import { completeCommandFacts, type RetrospectiveFactsReport } from './coverage.mts'
import type { RetrospectiveFactsOptions } from './shared.mts'

export type { CommandExecutor, CommandResult, RetrospectiveFactsOptions } from './shared.mts'
export type { RetrospectiveFactsReport } from './coverage.mts'

export async function runRetrospectiveFacts(options: RetrospectiveFactsOptions): Promise<string> {
  return (await runRetrospectiveFactsReport(options)).markdown
}

export async function runRetrospectiveFactsReport(
  options: RetrospectiveFactsOptions,
): Promise<RetrospectiveFactsReport> {
  validate(options)
  const execute = options.execute ?? shell
  let complete = true
  let successful = 0
  const collect: typeof execute = async (command, args) => {
    const result = await execute(command, args)
    if (result.ok) successful++
    if (!completeCommandFacts(command, args, result)) complete = false
    return result
  }
  const markdown = await (options.repo
    ? foreignFacts(options, collect)
    : localFacts(options, collect))
  return { markdown, coverage: complete ? 'complete' : successful ? 'partial' : 'unavailable' }
}

function validate(options: RetrospectiveFactsOptions): void {
  if (options.pr !== undefined && !/^\d+$/.test(options.pr))
    throw new Error('--pr requires a number')
  if (options.branch !== undefined && (!options.branch || options.branch.startsWith('-')))
    throw new Error('--branch requires a name')
  if (options.repo !== undefined && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(options.repo))
    throw new Error('--repo requires an owner/name value')
  if (options.pr && options.noPr) throw new Error('--pr and --no-pr are mutually exclusive')
  if (options.repo && options.branch) throw new Error('--branch cannot be combined with --repo')
  if (options.repo && options.noPr) throw new Error('--no-pr cannot be combined with --repo')
  if (options.repo && !options.pr)
    throw new Error('--repo requires --pr (a foreign repo has no current PR for this local branch)')
  if (!options.pr && !options.branch && !options.noPr)
    throw new Error('pass --pr <number>, --branch <name>, or --no-pr')
}
