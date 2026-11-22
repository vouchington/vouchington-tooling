import { posix } from 'node:path'

const CANONICAL_CHILD_FRAGMENT_LINK_RE =
  /^- <a id="[^"]+"><\/a>\[[^\]\n]+\]\((?![a-z][a-z0-9+.-]*:|\/)([^)#?\s]+\.md)#[^)\s]+\)$/gim
const CANONICAL_CHILD_LINK_RE =
  /^- <a id="[^"]+"><\/a>\[[^\]\n]+\]\((?![a-z][a-z0-9+.-]*:|\/)([^)#?\s]+\.md)\)$/gim

export interface CanonicalMarkdownChildLink {
  index: number
  link: string
  target: string
}

function canonicalTargetKey(target: string): string {
  return posix.normalize(target)
}

export function canonicalWholeFileLinks(rootContent: string): CanonicalMarkdownChildLink[] {
  return [...rootContent.matchAll(CANONICAL_CHILD_LINK_RE)].map((match) => ({
    index: match.index,
    link: match[0],
    target: match[1] as string,
  }))
}

export function canonicalWholeFileTargets(rootContent: string): Set<string> {
  return new Set(canonicalWholeFileLinks(rootContent).map((l) => canonicalTargetKey(l.target)))
}

export function canonicalFragmentTargets(rootContent: string): Set<string> {
  return new Set(
    [...rootContent.matchAll(CANONICAL_CHILD_FRAGMENT_LINK_RE)].map((match) =>
      canonicalTargetKey(match[1] as string),
    ),
  )
}

export function fragmentOnlyCanonicalChildTargets(rootContent: string): string[] {
  const wholeFileTargets = canonicalWholeFileTargets(rootContent)
  return [...canonicalFragmentTargets(rootContent)].filter(
    (target) => !wholeFileTargets.has(target),
  )
}
