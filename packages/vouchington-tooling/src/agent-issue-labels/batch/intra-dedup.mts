export const INTRA_DEDUP_THRESHOLD = 0.7

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

function tokenSet(title: string): Set<string> {
  return new Set(normalizeTitle(title).split(' ').filter(Boolean))
}

/** Token-Jaccard similarity of two titles, in [0, 1]. */
export function titleSimilarity(a: string, b: string): number {
  const setA = tokenSet(a)
  const setB = tokenSet(b)
  if (setA.size === 0 && setB.size === 0) return 1
  if (setA.size === 0 || setB.size === 0) return 0

  let intersectionSize = 0
  for (const token of setA) {
    if (setB.has(token)) intersectionSize += 1
  }
  const unionSize = setA.size + setB.size - intersectionSize
  return intersectionSize / unionSize
}

export type IntraBatchCollision = {
  a: string
  b: string
  similarity: number
}

export type IntraDedupCandidate = {
  id: string
  title: string
  duplicateSearch?: { acknowledgedSiblings?: string[] }
}

function mutuallyAcknowledged(a: IntraDedupCandidate, b: IntraDedupCandidate): boolean {
  const aAcks = a.duplicateSearch?.acknowledgedSiblings ?? []
  const bAcks = b.duplicateSearch?.acknowledgedSiblings ?? []
  return aAcks.includes(b.id) && bAcks.includes(a.id)
}

/**
 * Compares every pair of manifest entries' titles and returns the pairs at or above
 * INTRA_DEDUP_THRESHOLD, excluding pairs that mutually acknowledge each other as intentional
 * near-duplicate siblings (both entries must list the other's id in
 * `duplicateSearch.acknowledgedSiblings` — a one-sided ack does not suppress the collision).
 * O(n^2) over entry count, which is acceptable for realistic batch sizes (tens of entries).
 */
export function findIntraBatchCollisions(entries: IntraDedupCandidate[]): IntraBatchCollision[] {
  const collisions: IntraBatchCollision[] = []
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const similarity = titleSimilarity(entries[i]!.title, entries[j]!.title)
      if (similarity < INTRA_DEDUP_THRESHOLD) continue
      if (mutuallyAcknowledged(entries[i]!, entries[j]!)) continue
      collisions.push({ a: entries[i]!.id, b: entries[j]!.id, similarity })
    }
  }
  return collisions
}
