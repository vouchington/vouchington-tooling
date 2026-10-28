import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { MarkdownArticleInput } from './check.mts'

const execFileAsync = promisify(execFile)

export type GitLsFilesRunner = (root: string) => Promise<string[]>

export interface DiscoverMarkdownArticlesOptions {
  /** Basenames to skip. Defaults to `['README.md']`. */
  exclude?: readonly string[]
  /** Return an empty list instead of throwing when nothing is found. Defaults to `false`. */
  allowEmpty?: boolean
  /** Replaces the `git ls-files` runner; receives `root` and returns root-relative tracked paths. */
  listTrackedFiles?: GitLsFilesRunner
}

/** Runs `git ls-files -z -- '*.md'` with an argv array (no shell) from `root`. */
export async function gitLsFiles(root: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--', '*.md'], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout.split('\0').filter(Boolean)
}

/**
 * Lists git-tracked `*.md` files directly under `root` (not recursive), minus exclusions,
 * and returns them as sorted `{ name, source }` inputs. Throws when none are found unless
 * `allowEmpty` is set, so a wrong root cannot pass silently.
 */
export async function discoverMarkdownArticles(
  root: string,
  options: DiscoverMarkdownArticlesOptions = {},
): Promise<MarkdownArticleInput[]> {
  const exclude = new Set(options.exclude ?? ['README.md'])
  const tracked = await (options.listTrackedFiles ?? gitLsFiles)(root)
  const names = tracked
    .filter((path) => path.endsWith('.md') && !path.includes('/') && !exclude.has(path))
    .sort((a, b) => (a < b ? -1 : 1))
  if (names.length === 0 && !options.allowEmpty) {
    throw new Error(`No git-tracked markdown articles found directly under ${root}`)
  }
  return Promise.all(
    names.map(async (name) => ({ name, source: await readFile(join(root, name), 'utf8') })),
  )
}
