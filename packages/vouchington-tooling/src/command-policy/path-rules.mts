import { posix } from 'node:path'

import { referencesPath } from './path-references.mts'
import type { HookPayload, PathTypoRule, ProtectedPaths } from './types.mts'

/** True when `token` is the segment, or has it as a leading, trailing, or interior path segment. */
function tokenReferencesSegment(token: string, segment: string): boolean {
  return (
    token === segment ||
    token.startsWith(`${segment}/`) ||
    token.endsWith(`/${segment}`) ||
    token.includes(`/${segment}/`)
  )
}

/** The first typo rule the payload or command references, or undefined. */
export function findPathTypo(
  payload: HookPayload,
  command: string,
  rules: readonly PathTypoRule[],
): PathTypoRule | undefined {
  return rules.find((rule) =>
    referencesPath(payload, command, (token) => tokenReferencesSegment(token, rule.segment)),
  )
}

/**
 * Whether `rawToken` names a protected file or directory. Dot segments collapse
 * (`dir/./hooks/x` -> `dir/hooks/x`) so redundant path noise cannot hide a literal match. The match
 * is deliberately not resolved against the command's cwd, so a `cd` plus a relative path is the
 * indirection this check does not catch.
 */
export function protectedPathMatch(rawToken: string, protectedPaths: ProtectedPaths): boolean {
  const token = rawToken === '' ? rawToken : posix.normalize(rawToken)
  if (protectedPaths.exactFiles.some((file) => token === file || token.endsWith(`/${file}`))) {
    return true
  }
  return protectedPaths.dirPrefixes.some((prefix) => {
    const bareDir = prefix.slice(0, -1)
    return (
      token === bareDir ||
      token.startsWith(prefix) ||
      token.endsWith(`/${bareDir}`) ||
      token.includes(`/${prefix}`)
    )
  })
}

export function referencesProtectedPath(
  payload: HookPayload,
  command: string,
  protectedPaths: ProtectedPaths,
): boolean {
  return referencesPath(payload, command, (token) => protectedPathMatch(token, protectedPaths), {
    splitRedirections: true,
  })
}
