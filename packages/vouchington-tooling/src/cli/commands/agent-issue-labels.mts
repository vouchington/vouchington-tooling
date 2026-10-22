import { resolve } from 'node:path'
import {
  DEFAULT_LABELER_PATH,
  ensureLabels,
  labelsFromPaths,
  readLabelPolicyFile,
} from '../../agent-issue-labels/index.mts'
import type { ParsedAgentIssueLabels } from '../parse-agent-issue-labels.mts'

export async function runAgentIssueLabels(
  parsed: ParsedAgentIssueLabels,
  cwd: string = process.cwd(),
): Promise<number> {
  const labels =
    parsed.subcommand === 'labels-from-paths'
      ? await labelsFromPaths(parsed.paths, resolve(cwd, parsed.labeler ?? DEFAULT_LABELER_PATH))
      : await ensureLabels({
          labels: parsed.labels,
          update: parsed.update,
          ...(parsed.repo === undefined ? {} : { repo: parsed.repo }),
          ...(parsed.policyFile === undefined
            ? {}
            : { policy: readLabelPolicyFile(resolve(cwd, parsed.policyFile)) }),
        })
  for (const label of labels) process.stdout.write(`${label}\n`)
  return 0
}
