import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { gitConfiguredRemoteDefaults, gitRemoteVerbose } from './git-process.mts'

// GitHub's owner-name characters. A shell expansion (`$OWNER`, a glob, `~`) never matches, so an
// owner the hook can't read literally is never mistaken for a different one.
const GITHUB_OWNER = /^[a-z\d_][a-z\d_-]*$/i
const REPO_SELECTOR_CHARACTERS = /^[\w.:@/-]+$/
// One `git remote -v` line: `<name>\t<url> (fetch|push)`, which a partial clone suffixes with its
// ` [<filter>]`.
const REMOTE_LINE = /^[^\t]+\t(.+) \((fetch|push)\)(?: \[[^\]]*\])?$/

/**
 * Every lowercased owner of a checkout's GitHub repositories, read the way gh reads them: the fetch
 * URLs of `git remote -v` plus any `gh repo set-default` (`remote.<name>.gh-resolved`). Hostless
 * (local-path) remotes are ignored, like gh does; undefined when the checkout can't be read, prints
 * a remote line the hook doesn't recognize, or has a hosted remote or set-default that isn't
 * OWNER/REPO.
 */
export function checkoutOwners(cwd: string): ReadonlySet<string> | undefined {
  const remotes = gitRemoteVerbose(cwd)
  const defaults = gitConfiguredRemoteDefaults(cwd)
  if (remotes === undefined || defaults === undefined) {
    return undefined
  }
  const owners = new Set<string>()
  for (const line of remotes.split('\n').filter(Boolean)) {
    const owner = remoteLineOwner(line)
    if (owner === undefined) {
      return undefined
    }
    if (owner !== null) {
      owners.add(owner)
    }
  }
  for (const line of defaults.split('\n')) {
    const value = line.slice(line.indexOf(' ') + 1)
    if (line === '' || value === 'base') {
      continue
    }
    const owner = ownerOfRepoSelector(value)
    if (owner === undefined) {
      return undefined
    }
    owners.add(owner)
  }
  return owners
}

/**
 * A checkout's owner when {@link checkoutOwners} finds exactly one, so whichever remote gh picks is
 * that owner's; undefined when there are none or several.
 */
export function checkoutOwner(cwd: string): string | undefined {
  const owners = checkoutOwners(cwd)
  return owners?.size === 1 ? [...owners][0] : undefined
}

/**
 * The owners a session's own checkout belongs to: its {@link checkoutOwners} plus the owner of its
 * root `package.json` `repository`, so a fork-only checkout still counts the upstream it declares.
 * Undefined — keep every content rule — when either is unreadable, the declared repository isn't
 * a hosted OWNER/REPO, or no owner is known at all.
 */
export function sessionHomeOwners(worktreeRoot: string): ReadonlySet<string> | undefined {
  const owners = checkoutOwners(worktreeRoot)
  const declared = declaredRepositoryOwner(worktreeRoot)
  if (owners === undefined || declared === undefined) {
    return undefined
  }
  const home = declared === null ? owners : new Set([...owners, declared])
  return home.size === 0 ? undefined : home
}

// gh's `[HOST/]OWNER/REPO` or repository URL form.
export function ownerOfRepoSelector(value: string): string | undefined {
  const path = value.replace(/^https?:\/\//i, '').replace(/\/$/, '')
  const segments = path.split('/')
  if (!REPO_SELECTOR_CHARACTERS.test(path) || segments.length < 2 || segments.length > 3) {
    return undefined
  }
  return segments.includes('') ? undefined : githubOwner(segments[segments.length - 2]!)
}

export function githubOwner(value: string): string | undefined {
  return GITHUB_OWNER.test(value) ? value.toLowerCase() : undefined
}

// null when package.json is absent or declares no repository; undefined when it can't be read or
// the declaration isn't a hosted OWNER/REPO URL (npm's bare `owner/repo` shorthand included).
function declaredRepositoryOwner(root: string): string | null | undefined {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? null : undefined
  }
  const repository = (manifest as { repository?: unknown } | null)?.repository
  if (repository === undefined) {
    return null
  }
  const url = typeof repository === 'string' ? repository : (repository as { url?: unknown })?.url
  return typeof url === 'string' ? (ownerOfRemoteUrl(url) ?? undefined) : undefined
}

// null for a push line or a hostless fetch URL; undefined for a line the hook doesn't recognize.
function remoteLineOwner(line: string): string | null | undefined {
  const match = REMOTE_LINE.exec(line)
  if (match === null) {
    return undefined
  }
  return match[2] === 'push' ? null : ownerOfRemoteUrl(match[1]!)
}

// null for a hostless remote gh ignores (a local path or file://); undefined for a hosted URL that
// isn't OWNER/REPO.
function ownerOfRemoteUrl(url: string): string | null | undefined {
  const withScheme = /^([a-z][a-z\d+.-]*):\/\/([^/]*)(.*)$/i.exec(url)
  if (withScheme !== null) {
    const [, scheme, host, path] = withScheme
    return scheme!.toLowerCase() === 'file' || host === '' ? null : ownerOfRemotePath(path!)
  }
  // git's scp-like `[user@]host:path` form needs a colon before any slash.
  const scpLike = /^[^/:]+:(.*)$/.exec(url)
  return scpLike === null ? null : ownerOfRemotePath(scpLike[1]!)
}

function ownerOfRemotePath(path: string): string | undefined {
  const segments = path.replace(/^\/+|\/+$/g, '').split('/')
  return segments.length === 2 && segments[1] !== '' ? githubOwner(segments[0]!) : undefined
}
