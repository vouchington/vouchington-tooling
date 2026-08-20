import type { ArtifactClassification } from './classify.mts'
import type { GithubArtifact as ArtifactLike } from './github.mts'

export type { ArtifactLike }

export interface DeletionSummary {
  deletedCount: number
  bytesFreed: number
}

export function summarize(deleted: Array<Pick<ArtifactLike, 'size_in_bytes'>>): DeletionSummary {
  return {
    deletedCount: deleted.length,
    bytesFreed: deleted.reduce((total, artifact) => total + artifact.size_in_bytes, 0),
  }
}

export function planRunDeletions(
  artifacts: ArtifactLike[],
  classify: (name: string) => ArtifactClassification,
): ArtifactLike[] {
  return artifacts.filter((artifact) => !artifact.expired && classify(artifact.name) === 'delete')
}

export function isSweepCandidate(
  artifact: ArtifactLike,
  cutoffIso: string,
  classify: (name: string) => ArtifactClassification,
): boolean {
  return (
    !artifact.expired && artifact.created_at < cutoffIso && classify(artifact.name) === 'delete'
  )
}

export interface PagingState {
  page: number
  consecutiveExpiredPages: number
}

const MAX_CONSECUTIVE_EXPIRED_PAGES = 5
const MAX_PAGES = 150

export function shouldStopPaging(pageArtifacts: ArtifactLike[], state: PagingState): boolean {
  if (state.page >= MAX_PAGES) return true
  if (pageArtifacts.length === 0) return true
  return state.consecutiveExpiredPages >= MAX_CONSECUTIVE_EXPIRED_PAGES
}

export function nextPagingState(pageArtifacts: ArtifactLike[], state: PagingState): PagingState {
  const pageFullyExpired = pageArtifacts.every((artifact) => artifact.expired)
  return {
    page: state.page + 1,
    consecutiveExpiredPages: pageFullyExpired ? state.consecutiveExpiredPages + 1 : 0,
  }
}

export async function planSweepDeletions(
  candidates: ArtifactLike[],
  getConclusion: (runId: number) => Promise<string | null>,
): Promise<ArtifactLike[]> {
  const toDelete: ArtifactLike[] = []
  for (const artifact of candidates) {
    const runId = artifact.workflow_run?.id
    if (runId == null) continue
    const conclusion = await getConclusion(runId)
    if (conclusion === 'success' || conclusion === 'cancelled') toDelete.push(artifact)
  }
  return toDelete
}
