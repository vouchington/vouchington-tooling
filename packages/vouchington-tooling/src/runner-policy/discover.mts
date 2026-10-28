import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { parseRunnerPolicyConfig } from './config.mts'
import type { RunnerPolicyConfig, WorkflowInput } from './types.mts'

export const DEFAULT_WORKFLOW_ROOT = '.github/workflows'
export const DEFAULT_CONFIG_PATH = '.github/runner-policy.json'

/**
 * Reads every `*.yml` / `*.yaml` file directly under `root` (workflow directories are flat).
 * Throws when the root is missing or not a directory, or when any file cannot be read.
 */
export async function discoverWorkflows(root: string): Promise<WorkflowInput[]> {
  const directory = resolve(root)
  const info = await stat(directory).catch(() => undefined)
  if (info === undefined || !info.isDirectory()) {
    throw new Error(`workflow root "${root}" does not exist or is not a directory`)
  }
  const entries = await readdir(directory, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  return Promise.all(
    names.map(async (path) => ({ path, text: await readFile(join(directory, path), 'utf8') })),
  )
}

export async function loadRunnerPolicyConfig(file: string): Promise<RunnerPolicyConfig> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(resolve(file), 'utf8'))
  } catch (error) {
    throw new Error(`cannot read runner-policy config "${file}": ${(error as Error).message}`, {
      cause: error,
    })
  }
  return parseRunnerPolicyConfig(raw)
}
