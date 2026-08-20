const API_BASE = 'https://api.github.com'
const API_VERSION = '2022-11-28'
const MAX_RETRIES = 4
const PER_PAGE = 100

export interface GithubArtifact {
  id: number
  name: string
  size_in_bytes: number
  expired: boolean
  created_at: string
  workflow_run?: { id: number }
}

export type DeleteOutcome = 'deleted' | 'not-found' | 'failed'

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = Number(response?.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000
  return Math.min(1000 * 2 ** attempt, 30_000)
}

export async function githubGet(
  path: string,
  token: string,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response
    try {
      response = await fetch(`${API_BASE}${path}`, { headers: authHeaders(token) })
    } catch {
      if (attempt === MAX_RETRIES) return new Response(null, { status: 599 })
      await sleepFn(retryDelayMs(null, attempt))
      continue
    }
    if (response.status !== 403 && response.status !== 429) return response
    if (attempt === MAX_RETRIES) return response
    await sleepFn(retryDelayMs(response, attempt))
  }
}

export async function deleteArtifact(
  repo: string,
  token: string,
  artifactId: number,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<DeleteOutcome> {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response
    try {
      response = await fetch(`${API_BASE}/repos/${repo}/actions/artifacts/${artifactId}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      })
    } catch {
      if (attempt === MAX_RETRIES) return 'failed'
      await sleepFn(retryDelayMs(null, attempt))
      continue
    }
    if (response.status === 404) return 'not-found'
    if (response.ok) return 'deleted'
    if (response.status !== 403 && response.status !== 429) return 'failed'
    if (attempt === MAX_RETRIES) return 'failed'
    await sleepFn(retryDelayMs(response, attempt))
  }
}

export async function listRunArtifacts(
  repo: string,
  token: string,
  runId: string,
): Promise<GithubArtifact[]> {
  const artifacts: GithubArtifact[] = []
  for (let page = 1; ; page += 1) {
    const path = `/repos/${repo}/actions/runs/${runId}/artifacts?per_page=${PER_PAGE}&page=${page}`
    const response = await githubGet(path, token)
    if (!response.ok) break
    const body = (await response.json()) as { artifacts: GithubArtifact[] }
    artifacts.push(...body.artifacts)
    if (body.artifacts.length < PER_PAGE) break
  }
  return artifacts
}

export async function listArtifactsPage(
  repo: string,
  token: string,
  page: number,
): Promise<GithubArtifact[] | null> {
  const path = `/repos/${repo}/actions/artifacts?per_page=${PER_PAGE}&page=${page}`
  const response = await githubGet(path, token)
  if (!response.ok) return null
  const body = (await response.json()) as { artifacts: GithubArtifact[] }
  return body.artifacts
}

export async function getRunConclusion(
  repo: string,
  token: string,
  runId: number,
  cache: Map<number, string | null>,
): Promise<string | null> {
  if (cache.has(runId)) return cache.get(runId)!
  const response = await githubGet(`/repos/${repo}/actions/runs/${runId}`, token)
  if (!response.ok) {
    cache.set(runId, null)
    return null
  }
  const body = (await response.json()) as { status: string; conclusion: string | null }
  const conclusion = body.status === 'completed' ? body.conclusion : null
  cache.set(runId, conclusion)
  return conclusion
}
