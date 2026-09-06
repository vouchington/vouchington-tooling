import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { readTomlKey } from './merge-toml.mts'
import { CURSOR_APPROVAL_MODE } from './policy.mts'
import { HARNESS_IDS } from './types.mts'
import type { HarnessConfigOptions, HarnessId, HarnessPrerequisite } from './types.mts'

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

function selected(options: HarnessConfigOptions | undefined, harness: HarnessId): boolean {
  return (options?.harnesses ?? HARNESS_IDS).includes(harness)
}

function homeDir(options: HarnessConfigOptions | undefined): string {
  return resolve(options?.home ?? homedir())
}

async function codexTrust(
  root: string,
  options: HarnessConfigOptions | undefined,
): Promise<HarnessPrerequisite> {
  const source = await readOptional(join(homeDir(options), '.codex', 'config.toml'))
  const table = `projects.${JSON.stringify(resolve(root))}`
  return {
    harness: 'codex',
    key: 'trusted-project',
    message: 'trust this project in Codex before relying on its .codex/config.toml',
    satisfied: readTomlKey(source, table, 'trust_level') === 'trusted',
  }
}

async function cursorApproval(
  options: HarnessConfigOptions | undefined,
): Promise<HarnessPrerequisite> {
  const source = await readOptional(join(homeDir(options), '.cursor', 'cli-config.json'))
  let satisfied = false
  try {
    const parsed = JSON.parse(source) as { approvalMode?: unknown }
    satisfied = parsed.approvalMode === CURSOR_APPROVAL_MODE
  } catch {
    // A missing or invalid user config leaves the prerequisite unsatisfied.
  }
  return {
    harness: 'cursor',
    key: 'global-auto-review',
    message: 'set approvalMode=auto-review in ~/.cursor/cli-config.json',
    satisfied,
  }
}

function grokSandbox(): HarnessPrerequisite {
  return {
    harness: 'grok',
    key: 'sandbox-profile-selection',
    message: 'start Grok with --sandbox workspace-write to activate the defined profile',
    satisfied: false,
  }
}

export async function checkHarnessPrerequisites(
  root: string | undefined,
  options?: HarnessConfigOptions,
): Promise<HarnessPrerequisite[]> {
  const prerequisites: HarnessPrerequisite[] = []
  if (selected(options, 'grok')) prerequisites.push(grokSandbox())
  if (root !== undefined && selected(options, 'codex'))
    prerequisites.push(await codexTrust(root, options))
  if (root !== undefined && selected(options, 'cursor'))
    prerequisites.push(await cursorApproval(options))
  return prerequisites
}
