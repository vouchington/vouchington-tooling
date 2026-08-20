import type { ArtifactClassification } from './classify.mts'
import {
  deleteArtifact,
  getRunConclusion,
  listArtifactsPage,
  listRunArtifacts,
  type DeleteOutcome,
  type GithubArtifact,
} from './github.mts'
import {
  isSweepCandidate,
  nextPagingState,
  planRunDeletions,
  planSweepDeletions,
  shouldStopPaging,
  summarize,
  type DeletionSummary,
  type PagingState,
} from './plan.mts'

export interface CleanupDeps {
  listRunArtifacts: typeof listRunArtifacts
  listArtifactsPage: typeof listArtifactsPage
  getRunConclusion: typeof getRunConclusion
  deleteArtifact: typeof deleteArtifact
}

export const defaultDeps: CleanupDeps = {
  listRunArtifacts,
  listArtifactsPage,
  getRunConclusion,
  deleteArtifact,
}

export type CleanupRequest = {
  repo: string
  token: string
  classify: (name: string) => ArtifactClassification
  deps?: CleanupDeps
  log?: (message: string) => void
}

async function deleteAll(
  repo: string,
  token: string,
  artifacts: GithubArtifact[],
  deps: CleanupDeps,
  log: (message: string) => void,
): Promise<DeletionSummary> {
  const deleted: GithubArtifact[] = []
  for (const artifact of artifacts) {
    const outcome: DeleteOutcome = await deps.deleteArtifact(repo, token, artifact.id)
    if (outcome === 'failed') {
      log(`[gha-artifacts-cleanup] failed to delete ${artifact.name} (id ${artifact.id})`)
      continue
    }
    if (outcome === 'not-found') continue
    deleted.push(artifact)
  }
  return summarize(deleted)
}

export async function runCleanup(
  request: CleanupRequest & { runId: string },
): Promise<DeletionSummary> {
  const deps = request.deps ?? defaultDeps
  const log = request.log ?? console.error
  const artifacts = await deps.listRunArtifacts(request.repo, request.token, request.runId)
  const toDelete = planRunDeletions(artifacts, request.classify)
  return deleteAll(request.repo, request.token, toDelete, deps, log)
}

async function collectSweepCandidates(
  request: CleanupRequest,
  cutoffIso: string,
  deps: CleanupDeps,
): Promise<GithubArtifact[]> {
  const candidates: GithubArtifact[] = []
  let state: PagingState = { page: 1, consecutiveExpiredPages: 0 }
  for (;;) {
    const page = await deps.listArtifactsPage(request.repo, request.token, state.page)
    const pageArtifacts = page ?? []
    if (page != null) {
      candidates.push(
        ...pageArtifacts.filter((artifact) =>
          isSweepCandidate(artifact, cutoffIso, request.classify),
        ),
      )
    }
    if (page == null) break
    state = nextPagingState(pageArtifacts, state)
    if (shouldStopPaging(pageArtifacts, state)) break
  }
  return candidates
}

export async function sweepCleanup(
  request: CleanupRequest & { olderThanHours: number },
): Promise<DeletionSummary> {
  const deps = request.deps ?? defaultDeps
  const log = request.log ?? console.error
  const cutoffIso = new Date(Date.now() - request.olderThanHours * 60 * 60 * 1000).toISOString()
  const candidates = await collectSweepCandidates(request, cutoffIso, deps)
  const cache = new Map<number, string | null>()
  const toDelete = await planSweepDeletions(candidates, (runId) =>
    deps.getRunConclusion(request.repo, request.token, runId, cache),
  )
  return deleteAll(request.repo, request.token, toDelete, deps, log)
}
