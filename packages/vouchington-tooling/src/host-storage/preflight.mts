import { execFile } from 'node:child_process'
import { realpath, stat, statfs } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
  errorMessage,
  HOST_STORAGE_MINIMUM_FREE_BYTES,
  makeResolutionIssue,
  probeHostStorage,
  type HostStorageIssue,
  type HostStorageProbeDependencies,
  type HostStorageResult,
  type StorageCandidate,
} from './check.mts'

export const HOST_STORAGE_DISCOVERY_TIMEOUT_MS = 5_000
export const DOCKER_DESKTOP_STORAGE_RELATIVE_PATH =
  'Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw'

const execFileAsync = promisify(execFile)

export interface HostStorageDependencies extends HostStorageProbeDependencies {
  execFile(
    command: string,
    args: string[],
    options: { timeout: number },
  ): Promise<{ stdout: string }>
  homedir(): string
  platform: NodeJS.Platform
}

export type HostStorageInspectOptions = {
  discoverDockerRoot?: boolean
  discoverPnpmStore?: boolean
  discoveryTimeoutMs?: number
  dockerDesktopPath?: string
  minimumFreeBytes?: bigint
  paths: StorageCandidate[]
}

const defaultDependencies: HostStorageDependencies = {
  execFile: async (command, args, options) => {
    const { stdout } = await execFileAsync(command, args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: options.timeout,
    })
    return { stdout }
  },
  homedir,
  platform: platform(),
  realpath,
  stat: async (path) => ({ dev: (await stat(path, { bigint: true })).dev }),
  statfs: async (path) => {
    const result = await statfs(path, { bigint: true })
    return { bavail: result.bavail, bsize: result.bsize }
  },
}

async function discoverCommandPath(
  command: string,
  args: string[],
  label: string,
  recovery: string,
  dependencies: HostStorageDependencies,
  timeoutMs: number,
): Promise<{ candidate?: StorageCandidate; issue?: HostStorageIssue }> {
  const fallback = { label, path: `${command} ${args.join(' ')}`, recovery, required: false }
  try {
    const { stdout } = await dependencies.execFile(command, args, { timeout: timeoutMs })
    const path = stdout.trim()
    if (!path) throw new Error('command returned an empty path')
    return { candidate: { ...fallback, path } }
  } catch (err) {
    return { issue: makeResolutionIssue(fallback, errorMessage(err)) }
  }
}

function dockerDesktopCandidate(path: string): StorageCandidate {
  return {
    label: 'Docker Desktop storage',
    path,
    recovery:
      'Review Docker Desktop disk usage and reclaim unused images, containers, or volumes intentionally.',
    required: false,
  }
}

async function discoverOptionalStorage(
  options: HostStorageInspectOptions,
  dependencies: HostStorageDependencies,
): Promise<{ candidates: StorageCandidate[]; issues: HostStorageIssue[] }> {
  const candidates: StorageCandidate[] = []
  const issues: HostStorageIssue[] = []
  const timeoutMs = options.discoveryTimeoutMs ?? HOST_STORAGE_DISCOVERY_TIMEOUT_MS
  if (options.discoverPnpmStore) {
    const result = await discoverCommandPath(
      'pnpm',
      ['store', 'path'],
      'pnpm store',
      'Confirm pnpm is installed; after reviewing its contents, `pnpm store prune` can remove unused packages.',
      dependencies,
      timeoutMs,
    )
    if (result.candidate) candidates.push(result.candidate)
    if (result.issue) issues.push(result.issue)
  }
  if (!options.discoverDockerRoot) return { candidates, issues }

  if (dependencies.platform === 'darwin') {
    candidates.push(
      dockerDesktopCandidate(
        options.dockerDesktopPath ??
          join(dependencies.homedir(), DOCKER_DESKTOP_STORAGE_RELATIVE_PATH),
      ),
    )
  } else if (dependencies.platform === 'linux') {
    const result = await discoverCommandPath(
      'docker',
      ['info', '--format', '{{.DockerRootDir}}'],
      'Docker root',
      'Run `docker system df`, then reclaim only Docker images, containers, or volumes you have confirmed are unused.',
      dependencies,
      timeoutMs,
    )
    if (result.candidate) candidates.push(result.candidate)
    if (result.issue) issues.push(result.issue)
  } else {
    issues.push(
      makeResolutionIssue(
        {
          label: 'Docker root',
          path: 'Docker host storage',
          recovery: 'Inspect Docker storage using the platform-specific Docker tooling.',
          required: false,
        },
        `unsupported host platform ${dependencies.platform}`,
      ),
    )
  }
  return { candidates, issues }
}

export async function inspectHostStorage(
  options: HostStorageInspectOptions,
  dependencies: HostStorageDependencies = defaultDependencies,
): Promise<HostStorageResult> {
  const minimumFreeBytes = options.minimumFreeBytes ?? HOST_STORAGE_MINIMUM_FREE_BYTES
  const required = await probeHostStorage(options.paths, dependencies, minimumFreeBytes)
  if (!required.ok) return required

  const optional = await discoverOptionalStorage(options, dependencies)
  const result =
    optional.candidates.length === 0
      ? required
      : await probeHostStorage(
          [...options.paths, ...optional.candidates],
          dependencies,
          minimumFreeBytes,
        )
  return {
    ...result,
    issues: [...optional.issues, ...result.issues],
    ok: ![...optional.issues, ...result.issues].some((issue) => issue.severity === 'error'),
  }
}
