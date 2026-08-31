import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildContextFromTrackedFiles } from '../shared-context/index.mts'
import { checkGhaWorkspacePolicy, type GhaWorkspacePolicyOptions } from './index.mts'

describe('GitHub Actions persistent-workspace policy', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
  })

  async function checkRun(
    run: string,
    file = '.github/workflows/check.yml',
    options: GhaWorkspacePolicyOptions = {},
  ): Promise<string[]> {
    const root = await mkdtemp(join(tmpdir(), 'gha-workspace-policy-'))
    roots.push(root)
    await mkdir(dirname(join(root, file)), { recursive: true })
    const indented = run
      .split('\n')
      .map((line) => `          ${line}`)
      .join('\n')
    await writeFile(
      join(root, file),
      `name: check\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n${indented}\n`,
    )
    return (await checkGhaWorkspacePolicy(buildContextFromTrackedFiles(root, [file]), options))
      .errors
  }

  it.each([
    ['git sparse-checkout set src'],
    ['git -C . sparse-checkout add src'],
    ['git -C. sparse-checkout set src'],
    ['git --no-pager sparse-checkout set src'],
    ['git --no-optional-locks sparse-checkout set src'],
    ['git -c feature.manyFiles=true sparse-checkout reapply'],
    ['git sparse-checkout \\\nset src'],
    ['git config --worktree core.sparseCheckout true'],
    ['git config core.sparseCheckout=true'],
    ["git config core.sparseCheckoutCone 'yes'; git status"],
  ])('rejects sparse-checkout enabling command %s', async (command) => {
    expect(await checkRun(command)).toEqual([expect.stringContaining('enables sparse checkout')])
  })

  it('rejects checkout sparse inputs in workflows and composite actions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gha-workspace-policy-'))
    roots.push(root)
    const workflow = '.github/workflows/check.yml'
    const action = '.github/actions/check/action.yml'
    await mkdir(dirname(join(root, workflow)), { recursive: true })
    await mkdir(dirname(join(root, action)), { recursive: true })
    await writeFile(
      join(root, workflow),
      'jobs:\n  check:\n    steps:\n      - uses: actions/checkout@sha\n        with:\n          sparse-checkout: src\n',
    )
    await writeFile(
      join(root, action),
      'runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@sha\n      with:\n        sparse-checkout-cone-mode: false\n',
    )
    const errors = (
      await checkGhaWorkspacePolicy(buildContextFromTrackedFiles(root, [workflow, action]))
    ).errors
    expect(errors).toHaveLength(2)
    expect(errors.join('\n')).toContain('sparse-checkout')
    expect(errors.join('\n')).toContain('sparse-checkout-cone-mode')
  })

  it('reports both sparse checkout inputs on one checkout step', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gha-workspace-policy-'))
    roots.push(root)
    const file = '.github/workflows/check.yml'
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(
      join(root, file),
      'jobs:\n  check:\n    steps:\n      - uses: actions/checkout@sha\n        with:\n          sparse-checkout: src\n          sparse-checkout-cone-mode: false\n',
    )
    const result = await checkGhaWorkspacePolicy(buildContextFromTrackedFiles(root, [file]))
    expect(result.errors).toHaveLength(2)
  })

  it('allows commands that disable and unset sparse state', async () => {
    expect(
      await checkRun(
        'git sparse-checkout disable\ngit config --worktree --unset-all core.sparseCheckout || true',
      ),
    ).toEqual([])
  })

  it('supports additional consumer-owned workflow directories without product path knowledge', async () => {
    const file = 'ci/custom-workflows/check.yml'
    const command = 'git sparse-checkout set src'
    expect(await checkRun(command, file)).toEqual([])
    expect(
      await checkRun(command, file, {
        workflowDirectories: ['.github/workflows', 'ci/custom-workflows'],
      }),
    ).toEqual([expect.stringContaining('enables sparse checkout')])
  })

  it.each([
    ['docker run --rm -v"$GITHUB_WORKSPACE:/workspace" image:latest'],
    ['docker run -it -v "$GITHUB_WORKSPACE:/workspace" image:latest'],
    ['docker run -dit -u root -v "$GITHUB_WORKSPACE:/workspace" image:latest'],
    ['echo ready && docker run -v "$GITHUB_WORKSPACE:/workspace" image:latest'],
    ['docker run --mount "type=bind,source=$GITHUB_WORKSPACE,target=/workspace" image:latest'],
    ['docker run --mount "type=bind,source=${{ github.workspace }},target=/workspace" image'],
    ['docker run --mount type=bind,source=${{ github.workspace }},target=/workspace image'],
    ['docker run --mount "type=bind,source=${{ github.workspace }},target=/work\\"space" image'],
    ['docker --context default run -v "$GITHUB_WORKSPACE:/workspace" image:latest'],
    ['docker run --user root --volume "$GITHUB_WORKSPACE:/workspace" image:latest'],
    ['docker run --volume "$GITHUB_WORKSPACE:/workspace" image:latest --user "$(id -u):$(id -g)"'],
  ])('rejects unsafe writable workspace mount %s', async (command) => {
    expect(await checkRun(command)).toEqual([expect.stringContaining('host UID:GID mapping')])
  })

  it.each([
    [
      'docker container run --rm --user "$(id -u):$(id -g)" --volume "$GITHUB_WORKSPACE:/workspace" image:latest',
    ],
    ['docker run --volume "$GITHUB_WORKSPACE:/workspace:ro" image:latest'],
    ['docker run --volume "$HOME/cache:/cache" image:latest'],
    ['docker --unknown-global-option run -v "$GITHUB_WORKSPACE:/workspace" image:latest'],
    ['docker --debug run --volume "$HOME/cache:/cache" image:latest'],
    ['docker --config=/tmp run --volume "$HOME/cache:/cache" image:latest'],
    ['DOCKER_HOST=unix:///tmp/docker.sock docker run -v "$HOME/cache:/cache" image:latest'],
    ['docker version'],
    ['echo pre-docker-post'],
    ['echo docker run --volume "$GITHUB_WORKSPACE:/workspace" image:latest'],
    ['# docker run --volume "$GITHUB_WORKSPACE:/workspace" image:latest'],
    ['echo $(echo $(date)); docker run --volume "$HOME/cache:/cache" image:latest'],
    ['docker run --volume $HOME/cache\\:/cache image:latest'],
    ['docker run --volume=$HOME/cache:/cache image:latest'],
    ['docker run image:latest '],
    [
      'docker run --mount "type=bind,source=${{ github.workspace }},target=/workspace,readonly" image',
    ],
    [
      'docker run --rm \\\n  --user "$(id -u):$(id -g)" \\\n  --volume "$GITHUB_WORKSPACE:/workspace" \\\n  image:latest',
    ],
  ])('allows safe or unrelated Docker mount %s', async (command) => {
    expect(await checkRun(command)).toEqual([])
  })

  it('ignores untracked and unrelated files and reports invalid tracked YAML', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gha-workspace-policy-'))
    roots.push(root)
    const malformed = '.github/workflows/malformed.yml'
    await mkdir(dirname(join(root, malformed)), { recursive: true })
    await writeFile(join(root, malformed), 'jobs: {broken: {{')
    await expect(checkGhaWorkspacePolicy(buildContextFromTrackedFiles(root, []))).resolves.toEqual({
      errors: [],
    })
    await expect(
      checkGhaWorkspacePolicy(buildContextFromTrackedFiles(root, [malformed])),
    ).resolves.toEqual({
      errors: [expect.stringContaining('invalid YAML')],
    })
  })

  it('ignores non-repository contexts and incomplete workflow shapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gha-workspace-policy-'))
    roots.push(root)
    const noJobs = '.github/workflows/no-jobs.yml'
    const incompleteJobs = '.github/workflows/incomplete-jobs.yml'
    const incompleteAction = '.github/actions/incomplete/action.yml'
    for (const file of [noJobs, incompleteJobs, incompleteAction])
      await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, noJobs), 'name: no jobs\n')
    await writeFile(
      join(root, incompleteJobs),
      'jobs:\n  missing:\n  reusable:\n    uses: org/repo/.github/workflows/job.yml@sha\n  scalar-steps:\n    steps: nope\n  mixed-steps:\n    steps:\n      - nope\n  checkout:\n    steps:\n      - uses: actions/checkout@sha\n',
    )
    await writeFile(join(root, incompleteAction), 'name: no runs\n')
    const context = buildContextFromTrackedFiles(root, [noJobs, incompleteJobs, incompleteAction])

    await expect(checkGhaWorkspacePolicy(context)).resolves.toEqual({ errors: [] })
    const { isInsideGitRepo, repoRoot, trackedFiles, trackedFileSet } = context
    const fileSystemContext = { isInsideGitRepo, repoRoot, trackedFiles, trackedFileSet }
    await expect(checkGhaWorkspacePolicy(fileSystemContext)).resolves.toEqual({ errors: [] })
    await expect(checkGhaWorkspacePolicy({ ...context, isInsideGitRepo: false })).resolves.toEqual({
      errors: [],
    })
  })
})
