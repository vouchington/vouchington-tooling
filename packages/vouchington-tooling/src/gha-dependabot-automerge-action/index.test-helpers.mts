import { readFileSync } from 'node:fs'

import { parse as load } from 'yaml'

interface ActionStep {
  uses?: string
  with?: { script?: string }
}

type Action = { runs: { steps: ActionStep[] } }
export type DependencyUpdate = Record<
  'dependencyName' | 'directory' | 'newVersion' | 'packageEcosystem' | 'prevVersion' | 'updateType',
  string
>

export interface ScriptResult {
  failures: string[]
  infos: string[]
  mutationRequests: Array<{
    body: string
    headers: Record<string, string>
    method: string
    url: string
  }>
  restGetCalls: Array<Record<string, unknown>>
  warnings: string[]
}

const source = readFileSync('.github/actions/dependabot-automerge/action.yml', 'utf8')
const action = load(source) as Action
const script = action.runs.steps.find((step) => step.uses?.startsWith('actions/github-script@'))
  ?.with?.script

export function update(
  prevVersion: string,
  newVersion: string,
  updateType: string,
  dependencyName = 'example',
): DependencyUpdate {
  return {
    dependencyName,
    directory: '/',
    newVersion,
    packageEcosystem: 'npm',
    prevVersion,
    updateType,
  }
}

export async function runPolicy(
  metadata: DependencyUpdate[] | string | undefined,
  pullRequestOverrides: Record<string, unknown> = {},
  freshPullRequestOverrides: Record<string, unknown> = {},
  mergeToken: string | undefined = 'merge-token',
  mutationResult: { jsonError?: Error; payload?: unknown; status?: number } = {},
  dependabot = { directory: '/', ecosystem: 'npm' },
  expectedBase?: string,
  expectedHead?: string,
  manualRules = '[]',
  confirmedPullRequestOverrides: Error | Record<string, unknown> = freshPullRequestOverrides,
  initialRefreshError?: Error,
): Promise<ScriptResult> {
  if (!script) throw new Error('Dependabot auto-merge script is missing')
  const failures: string[] = []
  const infos: string[] = []
  const mutationRequests: ScriptResult['mutationRequests'] = []
  const restGetCalls: ScriptResult['restGetCalls'] = []
  const warnings: string[] = []
  const eventPullRequest = {
    auto_merge: null,
    base: { ref: 'main', sha: 'a'.repeat(40) },
    draft: false,
    head: {
      ref: 'dependabot/npm_and_yarn/example-1.5.0',
      repo: { full_name: 'example-owner/example-repo' },
      sha: 'b'.repeat(40),
    },
    node_id: 'PR_node_id',
    number: 123,
    merged: false,
    state: 'open',
    title: 'Bump dependencies',
    user: { login: 'dependabot[bot]' },
    ...pullRequestOverrides,
  }
  const github = {
    rest: {
      pulls: {
        async get(args: Record<string, unknown>) {
          restGetCalls.push(args)
          if (restGetCalls.length === 1 && initialRefreshError) throw initialRefreshError
          if (restGetCalls.length > 1 && confirmedPullRequestOverrides instanceof Error)
            throw confirmedPullRequestOverrides
          const overrides =
            restGetCalls.length === 1 || confirmedPullRequestOverrides instanceof Error
              ? freshPullRequestOverrides
              : confirmedPullRequestOverrides
          return { data: { ...eventPullRequest, ...overrides } }
        },
      },
    },
  }
  const context = {
    payload: { pull_request: eventPullRequest, repository: { default_branch: 'main' } },
    repo: { owner: 'example-owner', repo: 'example-repo' },
  }
  const core = {
    setFailed(message: string) {
      failures.push(message)
    },
    info(message: string) {
      infos.push(message)
    },
    warning(message: string) {
      warnings.push(message)
    },
  }
  const environment: Record<string, string> = {
    DEPENDABOT_DIRECTORY: dependabot.directory,
    DEPENDABOT_ECOSYSTEM: dependabot.ecosystem,
    EXPECTED_BASE_SHA: expectedBase ?? String((eventPullRequest.base as { sha: string }).sha),
    EXPECTED_HEAD_SHA: expectedHead ?? String((eventPullRequest.head as { sha: string }).sha),
    GRAPHQL_URL: 'https://github.example.test/api/graphql',
    MANUAL_UPDATE_RULES: manualRules,
  }
  if (metadata !== undefined)
    environment.UPDATED_DEPENDENCIES_JSON =
      typeof metadata === 'string' ? metadata : JSON.stringify(metadata)
  if (mergeToken !== undefined) environment.AUTOMERGE_TOKEN = mergeToken
  const fetch = async (url: string, init: RequestInit) => {
    if (typeof init.body !== 'string')
      throw new TypeError('Dependabot auto-merge mutation body must be a string')
    const body = init.body
    mutationRequests.push({
      body,
      headers: init.headers as Record<string, string>,
      method: String(init.method),
      url,
    })
    return {
      async json() {
        if (mutationResult.jsonError) throw mutationResult.jsonError
        return (
          mutationResult.payload ??
          (body.includes('disablePullRequestAutoMerge')
            ? { data: { disablePullRequestAutoMerge: { clientMutationId: null } } }
            : { data: { enablePullRequestAutoMerge: { clientMutationId: null } } })
        )
      },
      ok: (mutationResult.status ?? 200) < 400,
      status: mutationResult.status ?? 200,
    }
  }
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<void>
  await new AsyncFunction('github', 'context', 'core', 'process', 'fetch', script)(
    github,
    context,
    core,
    { env: environment },
    fetch,
  )
  return { failures, infos, mutationRequests, restGetCalls, warnings }
}
