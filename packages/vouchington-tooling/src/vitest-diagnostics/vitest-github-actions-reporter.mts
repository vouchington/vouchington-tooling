import path, { relative } from 'node:path'

export interface GithubActionsEnv {
  GITHUB_WORKSPACE?: string | undefined
  GITHUB_REPOSITORY?: string | undefined
  GITHUB_SHA?: string | undefined
}

export interface NormalizeGithubActionsPathOptions {
  env?: GithubActionsEnv
  cwd?: string
}

/** Rewrites an absolute path under the workspace or cwd to a repo-relative annotation path. */
export function normalizeGithubActionsPath(
  filePath: string,
  options: NormalizeGithubActionsPathOptions = {},
): string {
  const env = options.env ?? process.env
  const normalizedPath = filePath.replace(/\\/g, '/')
  const roots = [env.GITHUB_WORKSPACE, options.cwd ?? process.cwd()].filter(
    (root): root is string => Boolean(root),
  )
  for (const root of roots) {
    const normalizedRoot = root.replace(/\\/g, '/')
    const relativePath = path.isAbsolute(normalizedPath)
      ? relative(normalizedRoot, normalizedPath)
      : normalizedPath
    if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
      return relativePath.replace(/\\/g, '/')
    }
  }
  return normalizedPath
}

/** The `github-actions` reporter tuple with path normalization and job-summary links wired. */
export function githubActionsReporter(
  options: NormalizeGithubActionsPathOptions = {},
): readonly [string, Record<string, unknown>] {
  const env = options.env ?? process.env
  return [
    'github-actions',
    {
      onWritePath: (filePath: string) => normalizeGithubActionsPath(filePath, options),
      jobSummary: {
        enabled: false,
        fileLinks: {
          repository: env.GITHUB_REPOSITORY,
          commitHash: env.GITHUB_SHA,
          workspacePath: env.GITHUB_WORKSPACE,
        },
      },
    },
  ]
}
