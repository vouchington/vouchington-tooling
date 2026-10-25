import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { parse } from 'yaml'

import { isDownloadDatabaseOnly } from './gate.mts'
import { trivyPackageScanCommandSegments } from './invocations.mts'

type WorkflowStep = { run?: unknown; uses?: unknown }

export function isShellPolicySource(path: string): boolean {
  if (/\.(bash|sh|zsh)$/.test(path)) return true
  try {
    if ((statSync(path).mode & 0o111) === 0) return false
    const firstLine = readFileSync(path, 'utf8').split('\n', 1)[0] ?? ''
    return /^#!\s*(?:\/usr\/bin\/env(?:\s+-S)?\s+|\/(?:usr\/)?bin\/)(?:ba|z)?sh(?:\s|$)/.test(
      firstLine,
    )
  } catch {
    return false
  }
}

function workflowSteps(path: string): WorkflowStep[] {
  const document = parse(readFileSync(path, 'utf8')) as {
    jobs?: Record<string, { steps?: WorkflowStep[] }>
    runs?: { steps?: WorkflowStep[] }
  } | null
  return [
    ...Object.values(document?.jobs ?? {}).flatMap((job) => job.steps ?? []),
    ...(document?.runs?.steps ?? []),
  ]
}

export function assertNoUnsupportedTrivyAction(uses: unknown, path = 'fixture'): void {
  if (typeof uses === 'string' && /trivy/i.test(uses)) {
    throw new Error(`${path}: unsupported Trivy action ${uses}; use an auditable CLI run block`)
  }
}

function assertSupportedWorkflowSteps(paths: readonly string[]): string[] {
  const commands: string[] = []
  for (const path of paths) {
    for (const step of workflowSteps(path)) {
      assertNoUnsupportedTrivyAction(step.uses, path)
      if (typeof step.run !== 'string') continue
      commands.push(...trivyPackageScanCommandSegments(step.run))
    }
  }
  return commands
}

export function assertNoUnsupportedTrivyShellSource(source: string, path = 'fixture'): void {
  if (trivyPackageScanCommandSegments(source).some((command) => !isDownloadDatabaseOnly(command))) {
    throw new Error(
      `${path}: unsupported Trivy shell-script scan; use an auditable workflow run block`,
    )
  }
}

/** Every Trivy package-scan command in tracked workflows and composite actions. */
export function trivyPackageScanCommands(
  repositoryFiles: readonly string[],
  root: string,
): string[] {
  const present = repositoryFiles.filter((path) => existsSync(join(root, path)))
  for (const path of present.filter((path) => isShellPolicySource(join(root, path)))) {
    assertNoUnsupportedTrivyShellSource(readFileSync(join(root, path), 'utf8'), path)
  }
  const yamlPaths = [
    ...present.filter((path) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)),
    ...present.filter((path) => /^\.github\/actions\/.+\.ya?ml$/.test(path)),
  ]
  return assertSupportedWorkflowSteps(yamlPaths.map((path) => join(root, path)))
}
