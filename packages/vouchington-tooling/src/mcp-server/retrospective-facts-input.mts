import type { Args } from './args.mts'

/** A plain branch name: no scheme or colon, no leading dash, no `..`. */
const BRANCH = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/

/**
 * Checks `compose.facts`: either `{ status, reason }` (unassessed) or a live collection selector,
 * never both. Returns whether live collection was requested.
 */
export function checkFactsInput(facts: Args): boolean {
  const selectors = ['pr', 'branch', 'noPr'].filter((key) => key in facts)
  if ('status' in facts) {
    if (selectors.length)
      throw new Error(`compose.facts: status is exclusive with ${selectors.join(', ')}`)
    return false
  }
  if ('reason' in facts) throw new Error('compose.facts.reason requires a status')
  // The collector trusts these types; a string "false" must not read as noPr: true.
  // gh accepts a pull request URL for either, which would reach another repository.
  if ('pr' in facts && (typeof facts.pr !== 'string' || !/^\d+$/.test(facts.pr)))
    throw new Error('compose.facts.pr must be a pull request number string')
  if ('branch' in facts && (typeof facts.branch !== 'string' || !BRANCH.test(facts.branch)))
    throw new Error('compose.facts.branch must be a branch name')
  if ('noPr' in facts && typeof facts.noPr !== 'boolean')
    throw new Error('compose.facts.noPr must be a boolean')
  return true
}
