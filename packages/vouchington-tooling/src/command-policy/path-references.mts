import { tokenizeShellWords } from '../shell-parse/index.mts'
import { commandsToInspectForGitHubPolicy } from './github-command-context.mts'
import { isRecord } from './payload.mts'
import type { HookPayload } from './types.mts'

const PATCH_BEGIN = '*** Begin Patch'
const PATCH_HEADER_PREFIX = /^(?:\*\*\* (?:Add|Delete|Update) File:|\*\*\* Move to:)\s+/
const KEY_PATH_LIKE_RE = /(?:^|_)(?:cwd|file|filename|path|workdir|workspace)(?:_|$)/i

function keyLooksPathLike(key: string): boolean {
  const snake = key.replaceAll(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)
  return KEY_PATH_LIKE_RE.test(snake)
}

/** Header lines name the files an apply_patch touches; body text that mentions a path does not. */
function patchHeaderPaths(patch: string): string[] {
  return patch
    .split('\n')
    .filter((line) => PATCH_HEADER_PREFIX.test(line))
    .map((line) => line.replace(PATCH_HEADER_PREFIX, ''))
}

/**
 * Whether a path-shaped reference in the payload or the command satisfies `matches`: the payload's
 * path-like string fields, an apply_patch's header lines, and the command's shell words. The
 * command's own `command` field is read as shell text, never as a field value.
 */
export function referencesPath(
  payload: HookPayload,
  command: string,
  matches: (token: string) => boolean,
  options: { splitRedirections?: boolean } = {},
): boolean {
  return valueReferences(payload, matches) || commandReferences(command, matches, options)
}

function commandReferences(
  command: string,
  matches: (token: string) => boolean,
  options: { splitRedirections?: boolean },
): boolean {
  if (command.trimStart().startsWith(PATCH_BEGIN)) {
    return patchHeaderPaths(command).some(matches)
  }
  // `apply_patch <<'EOF'` carries its patch in a data heredoc that shell scanning blanks out.
  if (
    command.includes(PATCH_BEGIN) &&
    tokenizeShellWords(command, { splitRedirections: true }).includes('apply_patch') &&
    patchHeaderPaths(command).some(matches)
  ) {
    return true
  }
  // Without splitRedirections a no-space redirect like `>dir/file` stays fused to its operator.
  // Nested scripts (`sh -c`, substitutions, heredoc shell bodies) are read like the outer command.
  return commandsToInspectForGitHubPolicy(command).some((script) =>
    tokenizeShellWords(script, options).some(matches),
  )
}

function valueReferences(
  value: unknown,
  matches: (token: string) => boolean,
  key?: string,
): boolean {
  if (typeof value === 'string') {
    if (value.startsWith(PATCH_BEGIN)) {
      return patchHeaderPaths(value).some(matches)
    }
    return key !== undefined && keyLooksPathLike(key) && matches(value)
  }
  if (Array.isArray(value)) {
    return value.some((nested) => valueReferences(nested, matches, key))
  }
  if (!isRecord(value)) {
    return false
  }
  return Object.entries(value).some(
    ([nestedKey, nested]) => nestedKey !== 'command' && valueReferences(nested, matches, nestedKey),
  )
}
