import { runGh, type RunTextCommand } from '../gh-cli/exec.mts'
import { DEFAULT_LABEL_POLICY, labelMetadata, type LabelPolicy } from './label-policy.mts'

export type EnsureLabelsOptions = {
  labels: readonly string[]
  /** `owner/name`; defaults to the repository `gh` resolves from the working directory. */
  repo?: string
  policy?: LabelPolicy
  /** Rewrite metadata of labels that already exist (otherwise they are left untouched). */
  update?: boolean
  run?: RunTextCommand
}

/**
 * Creates missing repository labels through `gh` (or force-updates all with `update`). Every label
 * is validated against the policy before `gh` is called. A create that fails because the label
 * appeared concurrently is accepted. Returns the labels in the requested order.
 */
export async function ensureLabels(options: EnsureLabelsOptions): Promise<string[]> {
  const { labels, repo, update = false, run = runGh, policy = DEFAULT_LABEL_POLICY } = options
  if (labels.length === 0) throw new Error('at least one label is required')
  const metadata = labels.map((label) => labelMetadata(label, policy))
  const base = repo ? `repos/${repo}/labels` : 'repos/{owner}/{repo}/labels'
  const listed = await run([
    'api',
    '--paginate',
    '--slurp',
    '-X',
    'GET',
    base,
    '-F',
    'per_page=100',
  ])
  const existing = new Set(
    (JSON.parse(listed) as Array<Array<{ name: string }>>).flat().map(({ name }) => name),
  )
  for (const [index, label] of labels.entries()) {
    if (!update && existing.has(label)) continue
    const { color, description } = metadata[index]!
    try {
      await run([
        'label',
        'create',
        label,
        '--color',
        color,
        '--description',
        description,
        ...(update ? ['--force'] : []),
        ...(repo ? ['--repo', repo] : []),
      ])
    } catch (error) {
      if (update) throw error
      try {
        await run(['api', `${base}/${encodeURIComponent(label)}`, '--silent'])
      } catch {
        throw error
      }
    }
    existing.add(label)
  }
  return [...labels]
}
