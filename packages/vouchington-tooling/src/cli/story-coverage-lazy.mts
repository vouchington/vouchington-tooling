import { loadWithOptionalPeer } from './optional-peer.mts'
import type { ParsedStoryCoverage } from './parse-story-coverage.mts'

/** story-coverage value-imports the optional peer no-mistakes, so it loads only when dispatched. */
export async function runStoryCoverageLazy(parsed: ParsedStoryCoverage): Promise<number> {
  const { runStoryCoverage } = await loadWithOptionalPeer(
    'story-coverage',
    'no-mistakes',
    () => import('./commands/story-coverage.mts'),
  )
  return runStoryCoverage(parsed)
}
