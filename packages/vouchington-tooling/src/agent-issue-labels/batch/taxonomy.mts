function authStatusArgs(): string[] {
  return ['auth', 'status']
}

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
    '20',
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
 * 3 `gh` calls (auth check, labels, milestones) regardless of manifest size — callers must
 * not re-fetch per entry.
 */
export async function fetchTaxonomy(
  repo: string,
  deps: { runGh: (args: string[]) => Promise<string> },
): Promise<Taxonomy> {
  await deps.runGh(authStatusArgs())
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
