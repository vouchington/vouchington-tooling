/** Max issues fetched per duplicate search; a result this large may be truncated. */
export const DUPLICATE_SEARCH_LIMIT = 20

function labelListArgs(repo: string): string[] {
  return ['api', '--paginate', '--slurp', '-X', 'GET', `repos/${repo}/labels`, '-F', 'per_page=100']
}

function milestoneListArgs(repo: string): string[] {
  return [
    'api',
    '--paginate',
    '--slurp',
    '-X',
    'GET',
    `repos/${repo}/milestones`,
    '-F',
    'per_page=100',
    '-f',
    'state=open',
  ]
}

function duplicateSearchArgs(repo: string, query: string): string[] {
  return [
    'issue',
    'list',
    '--repo',
    repo,
    '--search',
    `${query} in:title`,
    '--state',
    'all',
    '--json',
    'number,title,url',
    '--limit',
    String(DUPLICATE_SEARCH_LIMIT),
  ]
}

export type Taxonomy = {
  labels: Set<string>
  milestones: Set<string>
}

type LabelPage = Array<{ name: string }>
type MilestonePage = Array<{ title: string }>

/**
 * Fetches the live label + milestone taxonomy once for the whole batch. Issues exactly
 * 2 `gh` calls (labels, milestones) regardless of manifest size — callers must
 * not re-fetch per entry.
 */
export async function fetchTaxonomy(
  repo: string,
  deps: { runGh: (args: string[]) => Promise<string> },
): Promise<Taxonomy> {
  const [rawLabels, rawMilestones] = await Promise.all([
    deps.runGh(labelListArgs(repo)),
    deps.runGh(milestoneListArgs(repo)),
  ])

  const labelPages = JSON.parse(rawLabels) as LabelPage[]
  const milestonePages = JSON.parse(rawMilestones) as MilestonePage[]

  return {
    labels: new Set(labelPages.flat().map((label) => label.name)),
    milestones: new Set(milestonePages.flat().map((milestone) => milestone.title)),
  }
}

export type DuplicateCandidate = { number: number; title: string; url: string }

/** Searches existing issues (open + closed) for title collisions against one manifest entry. */
export async function searchDuplicates(
  repo: string,
  query: string,
  deps: { runGh: (args: string[]) => Promise<string> },
): Promise<DuplicateCandidate[]> {
  const raw = await deps.runGh(duplicateSearchArgs(repo, query))
  return JSON.parse(raw) as DuplicateCandidate[]
}
