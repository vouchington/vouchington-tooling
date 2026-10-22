import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'

/**
 * Session names are the configured prefix plus a hash of the physical worktree
 * path, so same-basename worktrees never share a session.
 */
export function tmuxSessionName(prefix: string, root: string): string {
  const physical = realpathSync(root)
  return `${prefix}d${createHash('sha256').update(physical).digest('hex').slice(0, 12)}`
}
