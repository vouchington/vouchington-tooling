// Image policy shared by workflow and Dockerfile scans. Without `allowRegistries`, only Docker Hub
// is rejected. With it, every reference must start with one of the prefixes. A reference that
// expands a variable (`${{ }}`, `$VAR`) is judged by the text before the first variable, so it
// passes only when that literal text already starts with an allowed prefix; a wholly dynamic
// reference is rejected. `requireDigest` needs a literal `@sha256:<64 lowercase hex>` suffix, so a
// variable-expanded digest is rejected too.
export const DEFAULT_MIRROR = 'mirror.gcr.io'
const HUB_HOSTS = ['docker.io', 'index.docker.io', 'registry-1.docker.io']
const DIGEST = /@sha256:[0-9a-f]{64}$/u

export interface ImagePolicy {
  /** Prefixes every image reference must start with. Empty or omitted keeps the Docker Hub check. */
  readonly allowRegistries?: readonly string[] | undefined
  /** Require `@sha256:` followed by 64 lowercase hex characters. */
  readonly requireDigest?: boolean | undefined
}

export function policyActive(policy: ImagePolicy): boolean {
  return (policy.allowRegistries?.length ?? 0) > 0 || policy.requireDigest === true
}

export function cleanImage(reference: string): string {
  return reference.replace(/^["']|["'),;]+$/gu, '')
}

function knownPrefix(image: string): string {
  const dynamicAt = image.search(/\$|\{\{/u)
  return dynamicAt === -1 ? image : image.slice(0, dynamicAt)
}

function isHubImage(image: string): boolean {
  // Only the part before a variable is knowable; a wholly dynamic reference or registry is not.
  const known = knownPrefix(image)
  if (known === '') return false
  if (known !== image && !known.includes('/') && image.slice(known.length).includes('/')) {
    return false
  }
  const [first = ''] = known.split('/')
  if (!known.includes('/')) return true
  if (HUB_HOSTS.includes(first)) return true
  return !(first.includes('.') || first.includes(':') || first === 'localhost')
}

/** Reasons (empty when acceptable) that an image reference breaks the policy. */
export function imageReasons(
  reference: string,
  mirror: string,
  policy: ImagePolicy = {},
): string[] {
  const image = cleanImage(reference)
  if (image === '' || image === 'scratch') return []
  const allowed = policy.allowRegistries ?? []
  const reasons: string[] = []
  if (allowed.length === 0) {
    if (isHubImage(image)) reasons.push(`must come from ${mirror}/`)
  } else if (!allowed.some((prefix) => knownPrefix(image).startsWith(prefix))) {
    reasons.push(`must start with ${allowed.map((prefix) => `"${prefix}"`).join(' or ')}`)
  }
  if (policy.requireDigest === true && !DIGEST.test(image)) {
    reasons.push('must be pinned with @sha256:<64 lowercase hex characters>')
  }
  return reasons
}
