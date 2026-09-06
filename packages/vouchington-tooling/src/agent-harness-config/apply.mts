import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { applyJsonPatches } from './merge-json.mts'
import { applyTomlPatches } from './merge-toml.mts'
import { planGlobalFiles, planRepoFiles } from './paths.mts'
import { checkHarnessPrerequisites } from './prerequisites.mts'
import type {
  ApplyTarget,
  FilePlan,
  FileResult,
  HarnessApplyResult,
  HarnessCheckResult,
  HarnessConfigOptions,
  HarnessPlan,
  KeyDrift,
} from './types.mts'

export function planHarnessConfig(
  target: ApplyTarget,
  options?: HarnessConfigOptions,
): HarnessPlan {
  const files =
    target.kind === 'global' ? planGlobalFiles(options) : planRepoFiles(target.root, options)
  return { files, target }
}

async function readOptional(path: string): Promise<{ exists: boolean; source: string }> {
  try {
    return { exists: true, source: await readFile(path, 'utf8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, source: '' }
    throw error
  }
}

function patched(plan: FilePlan, source: string): { drifts: KeyDrift[]; text: string } {
  return plan.format === 'json'
    ? applyJsonPatches(source, plan.patches, plan.path)
    : applyTomlPatches(source, plan.patches, plan.path)
}

function fileResult(plan: FilePlan, exists: boolean, drifts: readonly KeyDrift[]): FileResult {
  if (!exists) return { action: 'missing', drifts, path: plan.path }
  return { action: drifts.length === 0 ? 'ok' : 'update', drifts, path: plan.path }
}

export async function checkHarnessConfig(
  target: ApplyTarget,
  options?: HarnessConfigOptions,
): Promise<HarnessCheckResult> {
  const plan = planHarnessConfig(target, options)
  const files: FileResult[] = []
  for (const file of plan.files) {
    const { exists, source } = await readOptional(file.path)
    files.push(fileResult(file, exists, patched(file, source).drifts))
  }
  const prerequisites = await checkHarnessPrerequisites(
    target.kind === 'repo' ? target.root : undefined,
    options,
  )
  return {
    compliant:
      files.every((file) => file.action === 'ok') &&
      prerequisites.every((prerequisite) => prerequisite.satisfied),
    files,
    prerequisites,
    target,
  }
}

export async function applyHarnessConfig(
  target: ApplyTarget,
  options?: HarnessConfigOptions,
): Promise<HarnessApplyResult> {
  const plan = planHarnessConfig(target, options)
  const files: FileResult[] = []
  const written: string[] = []
  for (const file of plan.files) {
    const { exists, source } = await readOptional(file.path)
    const next = patched(file, source)
    const result = fileResult(file, exists, next.drifts)
    if (result.action === 'ok') {
      files.push(result)
      continue
    }
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, next.text)
    files.push({ ...result, action: exists ? 'update' : 'create' })
    written.push(file.path)
  }
  const prerequisites = await checkHarnessPrerequisites(
    target.kind === 'repo' ? target.root : undefined,
    options,
  )
  return {
    compliant: prerequisites.every((prerequisite) => prerequisite.satisfied),
    files,
    prerequisites,
    target,
    written,
  }
}
