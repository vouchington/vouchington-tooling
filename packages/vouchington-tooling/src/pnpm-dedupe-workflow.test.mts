import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

interface Step {
  name?: string
  id?: string
  if?: string
  uses?: string
  env?: Record<string, string>
  run?: string
  with?: Record<string, unknown>
  'timeout-minutes'?: number
}

interface Workflow {
  on: {
    workflow_call: {
      inputs: Record<string, { required?: boolean; type: string; default?: unknown }>
      secrets: Record<string, { required: boolean }>
    }
  }
  permissions: Record<string, string>
  concurrency: { group: string; 'cancel-in-progress': boolean }
  jobs: {
    dedupe: { 'runs-on': string; outputs: Record<string, string>; steps: Step[] }
    publish: { needs: string; if: string; steps: Step[] }
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const workflowText = readFileSync(join(root, '.github/workflows/pnpm-dedupe.yml'), 'utf8')
const workflow = load(workflowText) as Workflow
const steps = workflow.jobs.dedupe.steps
const publishSteps = workflow.jobs.publish.steps
const checkout = steps.find((step) => step.uses?.includes('actions/checkout'))
const push = publishSteps.find((step) => step.name === 'Commit and push')
const openPr = publishSteps.find((step) => step.name === 'Open PR if missing')

function runStep(step: Step | undefined, env: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'pnpm-dedupe-'))
  writeFileSync(
    join(directory, 'gh'),
    '#!/bin/bash\nprintf "%s\\n" "$*" >> "$FAKE_GH_DIR/calls"\nprintf "%s\\n" "$FAKE_PR_NUMBER"\n',
  )
  chmodSync(join(directory, 'gh'), 0o755)
  const result = spawnSync('bash', ['-c', step?.run ?? 'exit 99'], {
    encoding: 'utf8',
    env: {
      PATH: `${directory}:${process.env.PATH ?? ''}`,
      FAKE_GH_DIR: directory,
      FAKE_PR_NUMBER: '',
      ...env,
    },
  })
  const calls = (() => {
    try {
      return readFileSync(join(directory, 'calls'), 'utf8')
    } catch {
      return ''
    }
  })()
  rmSync(directory, { recursive: true, force: true })
  return { ...result, calls }
}

describe('pnpm-dedupe reusable workflow', () => {
  it('keeps the call contract and the read-only checkout', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_call'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.on.workflow_call.secrets.PUSH_TOKEN?.required).toBe(true)
    expect(workflow.on.workflow_call.inputs).toMatchObject({
      base: { default: 'main', type: 'string' },
      branch: { default: 'chore/pnpm-dedupe', type: 'string' },
      label: { default: 'github_actions', type: 'string' },
      title: { default: 'chore(deps): pnpm dedupe', type: 'string' },
    })
    expect(workflow.concurrency).toEqual({
      group: 'pnpm-dedupe-${{ inputs.branch }}',
      'cancel-in-progress': false,
    })
    expect(checkout?.with).toMatchObject({ 'persist-credentials': false, 'fetch-depth': 0 })
    expect(checkout?.with).not.toHaveProperty('token')
    expect(workflowText).not.toContain('secrets: inherit')
    expect(workflowText).not.toContain('DEPENDABOT_AUTOMERGE_TOKEN')
    expect(workflowText).not.toMatch(/voucha|filament|storybook|vouchington-machines|openai/iu)
  })

  it('installs pnpm 12 only after Node is on PATH', () => {
    const setupNode = steps.findIndex((step) => step.uses?.startsWith('actions/setup-node'))
    const setupPnpm = steps.findIndex((step) => step.uses?.startsWith('pnpm/action-setup'))
    expect(setupNode).toBeGreaterThanOrEqual(0)
    expect(setupPnpm).toBeGreaterThan(setupNode)
    expect(steps[setupPnpm]?.with).toEqual({ version: 'latest-12' })
  })

  it('keeps the push token out of argv and out of the install environment', () => {
    expect(push?.env?.TOKEN).toBe('${{ secrets.PUSH_TOKEN }}')
    expect(push?.run).toContain('GIT_CONFIG_KEY_0=http.extraheader')
    expect(push?.run).toContain('-c core.hooksPath=/dev/null commit')
    expect(push?.run).toContain('-c core.hooksPath=/dev/null push')
    expect(push?.run).not.toMatch(/^[ \t]*git push/m)
    expect(openPr?.env?.OWNER).toBe('${{ github.repository_owner }}')
    expect(openPr?.env?.GH_TOKEN).toBe('${{ secrets.PUSH_TOKEN }}')
    expect(openPr?.run).toContain('headRepositoryOwner')
    expect(openPr?.run).toContain('headRefName')
    expect(openPr?.run).toContain('$OWNER')
    expect(workflowText).not.toContain("--jq '.[0].number'")
  })

  it('runs caller scripts only in a job that never sees PUSH_TOKEN', () => {
    const dedupeText = JSON.stringify(workflow.jobs.dedupe)
    expect(dedupeText).not.toContain('PUSH_TOKEN')
    expect(dedupeText).not.toContain('secrets.')
    expect(steps.some((step) => step.run?.includes('pnpm install'))).toBe(true)
    expect(steps.some((step) => step.run?.includes('pnpm dedupe'))).toBe(true)
    expect(workflow.jobs.dedupe.outputs.changed).toBe('${{ steps.diff.outputs.changed }}')
    const upload = steps.find((step) => step.uses?.includes('actions/upload-artifact'))
    expect(upload?.if).toBe("steps.diff.outputs.changed == 'true'")
    expect(upload?.with).toMatchObject({ name: 'pnpm-dedupe-lockfile', path: 'pnpm-lock.yaml' })
  })

  it('applies only the lockfile artifact in the token job and runs nothing from the repository', () => {
    expect(workflow.jobs.publish.needs).toBe('dedupe')
    expect(workflow.jobs.publish.if).toBe("needs.dedupe.outputs.changed == 'true'")
    const download = publishSteps.find((step) => step.uses?.includes('actions/download-artifact'))
    expect(download?.with).toMatchObject({ name: 'pnpm-dedupe-lockfile' })
    expect(publishSteps.some((step) => step.uses?.includes('setup-node'))).toBe(false)
    expect(publishSteps.some((step) => step.uses?.includes('pnpm/action-setup'))).toBe(false)
    const runs = publishSteps.map((step) => step.run ?? '').join('\n')
    expect(runs).not.toMatch(/^\s*(pnpm|npm|npx|node)\s/mu)
    expect(publishSteps[0]?.with).toMatchObject({ 'persist-credentials': false })
    expect(publishSteps.find((step) => step.name === 'Apply lockfile')?.run).toContain(
      'cp -- "$DEDUPED_DIR/pnpm-lock.yaml" pnpm-lock.yaml',
    )
  })

  it('rejects a branch that is not a relative ref before git or gh runs', () => {
    expect(runStep(push, { BRANCH: ' ../main', TITLE: 'dedupe', TOKEN: 'token' }).status).toBe(2)
    const opened = runStep(openPr, {
      BASE: 'main',
      BRANCH: 'chore/pnpm-dedupe',
      LABEL: 'has space',
      OWNER: 'example',
      TITLE: 'dedupe',
    })
    expect(opened.status).toBe(2)
    expect(opened.calls).toBe('')
  })

  it('skips creating a pull request owned by this repository', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pnpm-dedupe-pr-'))
    writeFileSync(
      join(directory, 'gh'),
      '#!/bin/bash\nprintf "%s\\n" "$*" >> "$FAKE_GH_DIR/calls"\nif [[ "$*" == *"pr list"* ]]; then printf "%s\\n" 7; fi\n',
    )
    chmodSync(join(directory, 'gh'), 0o755)
    const result = spawnSync('bash', ['-c', openPr?.run ?? 'exit 99'], {
      encoding: 'utf8',
      env: {
        PATH: `${directory}:${process.env.PATH ?? ''}`,
        FAKE_GH_DIR: directory,
        BASE: 'main',
        BRANCH: 'chore/pnpm-dedupe',
        LABEL: 'github_actions',
        OWNER: 'example',
        TITLE: 'chore(deps): pnpm dedupe',
      },
    })
    const calls = readFileSync(join(directory, 'calls'), 'utf8')
    rmSync(directory, { recursive: true, force: true })
    expect(result.status).toBe(0)
    expect(calls).toContain('pr list')
    expect(calls).not.toContain('pr create')
  })
})
