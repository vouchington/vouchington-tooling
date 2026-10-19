import type { HostStorageDependencies } from './preflight.mts'
import type { StorageCandidate } from './check.mts'

const RECOVERY = 'Free host storage, then retry.'

export type FakeFilesystem = {
  availableBytes: bigint
  device: bigint
}

export function requiredPath(label: string, path: string): StorageCandidate {
  return { label, path, recovery: RECOVERY, required: true }
}

export function standardPaths(
  home = '/home/developer',
  temporaryDirectory = '/tmp',
  worktree = '/repo',
): StorageCandidate[] {
  return [
    requiredPath('worktree', worktree),
    requiredPath('home directory', home),
    requiredPath('temporary directory', temporaryDirectory),
  ]
}

export function makeDependencies({
  commandResults = new Map<string, Error | string>(),
  filesystems = new Map<string, FakeFilesystem>(),
  home = '/home/developer',
  platform = 'linux' as NodeJS.Platform,
  realpathFailures = new Set<string>(),
  statFailures = new Set<string>(),
  statfsFailures = new Set<string>(),
  thrown = new Map<string, unknown>(),
}: {
  commandResults?: Map<string, Error | string>
  filesystems?: Map<string, FakeFilesystem>
  home?: string
  platform?: NodeJS.Platform
  realpathFailures?: Set<string>
  statFailures?: Set<string>
  statfsFailures?: Set<string>
  thrown?: Map<string, unknown>
} = {}) {
  const commandCalls: { args: string[]; command: string; timeout: number }[] = []
  const statfsCalls: string[] = []
  const dependencies: HostStorageDependencies = {
    execFile: async (command, args, options) => {
      commandCalls.push({ args, command, timeout: options.timeout })
      const key = `${command} ${args.join(' ')}`
      const failure = thrown.get(key)
      if (failure !== undefined) throw failure
      const result = commandResults.get(key)
      if (result instanceof Error) throw result
      if (result === undefined) throw new Error(`unexpected command: ${key}`)
      return { stdout: result }
    },
    homedir: () => home,
    platform,
    realpath: async (path) => {
      if (realpathFailures.has(path)) throw new Error(`cannot resolve ${path}`)
      const failure = thrown.get(path)
      if (failure !== undefined) throw failure
      return path
    },
    stat: async (path) => {
      if (statFailures.has(path)) throw new Error(`cannot stat ${path}`)
      const filesystem = filesystems.get(path)
      if (!filesystem) throw new Error(`missing fake filesystem for ${path}`)
      return { dev: filesystem.device }
    },
    statfs: async (path) => {
      statfsCalls.push(path)
      if (statfsFailures.has(path)) throw new Error(`cannot statfs ${path}`)
      const filesystem = filesystems.get(path)
      if (!filesystem) throw new Error(`missing fake filesystem for ${path}`)
      return { bavail: filesystem.availableBytes, bsize: 1n }
    },
  }
  return { commandCalls, dependencies, statfsCalls }
}
