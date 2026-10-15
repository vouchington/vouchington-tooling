import { createPullRequest } from '../gh-cli/pr-create.mts'
import type { Args } from './args.mts'
import type { ToolHandler } from './context.mts'
import { pullRequestNumber, withBodyFile } from './pr-body-file.mts'
import { pullRequestDefaults } from './pr-defaults.mts'
import { positiveInteger } from './pr-input.mts'
import { assertJournalUnchanged } from './pr-live.mts'
import { ghIn, gitIn, policyFor, prepare, type Prepared } from './pr-prepare.mts'

function readPr(args: Args, required: boolean): number | undefined {
  if (args.pr === undefined && !required) return undefined
  return positiveInteger(args.pr, 'pr')
}

function rejectErrors(prepared: Prepared): void {
  if (prepared.errors.length)
    throw new Error(`policy rejected the pull request:\n- ${prepared.errors.join('\n- ')}`)
}

export const handlePrValidate: ToolHandler = async (args, context) => {
  const { body, errors, warnings } = await prepare(args, context, 'validate', readPr(args, false))
  return { body, errors, warnings }
}

export const handlePrCreate: ToolHandler = async (args, context) => {
  const prepared = await prepare(args, context, 'create', undefined)
  rejectErrors(prepared)
  const { input, head, body } = prepared
  const defaults = await pullRequestDefaults(policyFor(context), input)
  const url = await withBodyFile(body, (bodyFile) =>
    createPullRequest(
      { runGh: ghIn(context), runGit: gitIn(context) },
      {
        bodyFile,
        draft: true,
        title: input.title,
        base: input.base,
        head,
        labels: defaults.labels,
        ...(defaults.milestone === undefined ? {} : { milestone: defaults.milestone }),
        ...(defaults.project === undefined ? {} : { projects: [defaults.project] }),
      },
    ),
  )
  return { number: pullRequestNumber(url), url, warnings: prepared.warnings }
}

export const handlePrUpdate: ToolHandler = async (args, context) => {
  const pr = readPr(args, true) as number
  const prepared = await prepare(args, context, 'update', pr)
  rejectErrors(prepared)
  await assertJournalUnchanged(ghIn(context), pr, prepared.liveBody as string, prepared.input.base)
  const url = await withBodyFile(prepared.body, async (bodyFile) =>
    (
      await ghIn(context)([
        'pr',
        'edit',
        String(pr),
        '--title',
        prepared.input.title,
        '--body-file',
        bodyFile,
      ])
    ).trim(),
  )
  return { number: pr, url, warnings: prepared.warnings }
}
