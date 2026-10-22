import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AuditArgs } from './args.mts'
import { classifyAudit, type CoveragePolicy } from './classify.mts'
import { HEADER, formatReport } from './report.mts'
import { resolveRepoRoots } from './repo-scope.mts'
import { scanTranscripts } from './scan.mts'
import type { ScanRules } from './types.mts'

export type PolicyContext = { settingsPath?: string; cwd: string }

/**
 * What a repository injects. `loadPolicy` turns the settings location into the repository's
 * coverage answer (or `{ error }` when it cannot); `classifyFailure` and `limits` extend the scan;
 * `worktreeGlobs` names extra worktree layouts to scope transcripts to.
 */
export type AuditRules = ScanRules & {
  loadPolicy: (
    context: PolicyContext,
  ) => CoveragePolicy | { error: string } | Promise<CoveragePolicy | { error: string }>
  worktreeGlobs?: string[]
}

export type LoadRulesModule = (specifier: string) => Promise<unknown>

export const importRulesModule: LoadRulesModule = (specifier) => import(specifier)

/**
 * Imports a `--rules` module. The default export or a named `rules` export must be an object with
 * a `loadPolicy` function (or a function returning one); a relative path resolves against `cwd`.
 */
export async function loadAuditRules(
  specifier: string,
  cwd: string,
  load: LoadRulesModule = importRulesModule,
): Promise<AuditRules> {
  const loaded = (await load(pathToFileURL(resolve(cwd, specifier)).href)) as {
    default?: unknown
    rules?: unknown
  }
  const exported = loaded.rules ?? loaded.default
  const rules = typeof exported === 'function' ? await exported() : exported
  const loadPolicy = (rules as Partial<AuditRules> | null | undefined)?.loadPolicy
  if (typeof loadPolicy !== 'function') {
    throw new Error(`rules module ${specifier} must export an object with a loadPolicy function`)
  }
  return rules as AuditRules
}

export type RunDeps = {
  cwd: string
  load?: LoadRulesModule
}

const unavailable = (reason: string): string => `${HEADER}\nStatus: unavailable (${reason})\n`

/**
 * Scan, classify, report. A repository that cannot be resolved or a policy that cannot load yields
 * an `unavailable` report rather than an error, so a retrospective can still embed the output.
 */
export async function runAudit(args: AuditArgs, deps: RunDeps): Promise<string> {
  const rules = await loadAuditRules(args.rules, deps.cwd, deps.load)
  let repoRoots: string[]
  try {
    repoRoots = await resolveRepoRoots(deps.cwd, {
      worktreeGlobs: [...(rules.worktreeGlobs ?? []), ...args.worktreeGlobs],
      ...(args.repoRoots === undefined ? {} : { explicit: args.repoRoots }),
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return unavailable(
      `repo root resolution failed: ${reason} — pass --repo-root to skip git and scope discovery explicitly`,
    )
  }
  const policy = await rules.loadPolicy({
    cwd: deps.cwd,
    ...(args.settingsPath === undefined ? {} : { settingsPath: args.settingsPath }),
  })
  if ('error' in policy) return unavailable(policy.error)
  const scan = await scanTranscripts({
    projectsDir: args.projectsDir,
    codexSessionsDir: args.codexSessionsDir,
    maxFilesPerRoot: args.maxFilesPerRoot,
    repoRoots,
    ...(args.sinceDays === undefined ? {} : { sinceDays: args.sinceDays }),
    ...(args.sessionId === undefined ? {} : { sessionId: args.sessionId }),
    ...(rules.classifyFailure === undefined ? {} : { classifyFailure: rules.classifyFailure }),
    ...(rules.limits === undefined ? {} : { limits: rules.limits }),
  })
  return formatReport(scan, classifyAudit(scan, policy), args)
}
