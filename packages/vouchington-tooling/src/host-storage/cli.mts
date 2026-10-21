import { formatGiB, HOST_STORAGE_MINIMUM_FREE_BYTES, errorMessage } from './check.mts'
import {
  inspectHostStorage,
  MAX_DISCOVERY_TIMEOUT_MS,
  type HostStorageDependencies,
  type HostStorageInspectOptions,
} from './preflight.mts'

export type HostStorageOutput = {
  error(message: string): void
  log(message: string): void
}

const RECOVERY = 'Free host storage, then retry.'

export function parseHostStorageCliArguments(args: string[]): HostStorageInspectOptions {
  const paths: HostStorageInspectOptions['paths'] = []
  let minimumFreeBytes: bigint | undefined
  let discoveryTimeoutMs: number | undefined
  let dockerDesktopPath: string | undefined
  let discoverPnpmStore = false
  let discoverDockerRoot = false
  let index = 0
  while (index < args.length) {
    const arg = args[index] as string
    if (arg === '--pnpm-store') {
      discoverPnpmStore = true
      index += 1
      continue
    }
    if (arg === '--docker-root') {
      discoverDockerRoot = true
      index += 1
      continue
    }
    if (
      arg === '--path' ||
      arg === '--minimum-free-bytes' ||
      arg === '--discovery-timeout-ms' ||
      arg === '--docker-desktop-path'
    ) {
      const value = readFlagValue(args, index, arg)
      index += 2
      if (arg === '--path') {
        paths.push({ label: value, path: value, recovery: RECOVERY, required: true })
      } else if (arg === '--docker-desktop-path') {
        dockerDesktopPath = value
      } else if (arg === '--discovery-timeout-ms') {
        discoveryTimeoutMs = parsePositiveInteger(value, arg)
      } else {
        minimumFreeBytes = parseNonNegativeBigint(value, arg)
      }
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }
  if (paths.length === 0) throw new Error('--path requires a path')
  return {
    discoverDockerRoot,
    discoverPnpmStore,
    paths,
    ...(minimumFreeBytes === undefined ? {} : { minimumFreeBytes }),
    ...(discoveryTimeoutMs === undefined ? {} : { discoveryTimeoutMs }),
    ...(dockerDesktopPath === undefined ? {} : { dockerDesktopPath }),
  }
}

function readFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${flag} requires a positive integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > MAX_DISCOVERY_TIMEOUT_MS) {
    throw new Error(
      `${flag} requires a positive integer no greater than ${MAX_DISCOVERY_TIMEOUT_MS}`,
    )
  }
  return parsed
}

function parseNonNegativeBigint(value: string, flag: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} requires a whole number`)
  return BigInt(value)
}

export async function runHostStoragePreflightCli(
  args: string[],
  dependencies?: HostStorageDependencies,
  output: HostStorageOutput = console,
): Promise<number> {
  let options: HostStorageInspectOptions
  try {
    options = parseHostStorageCliArguments(args)
  } catch (err) {
    output.error(`Host storage preflight usage error: ${errorMessage(err)}`)
    return 2
  }

  try {
    const result =
      dependencies === undefined
        ? await inspectHostStorage(options)
        : await inspectHostStorage(options, dependencies)
    for (const issue of result.issues) {
      output.error(`${issue.severity === 'error' ? 'Error' : 'Warning'}: ${issue.message}`)
    }
    if (!result.ok) return 1
    output.log(
      `Host storage preflight passed: ${formatGiB(options.minimumFreeBytes ?? HOST_STORAGE_MINIMUM_FREE_BYTES)} minimum free.`,
    )
    return 0
  } catch (err) {
    output.error(`Host storage preflight failed: ${errorMessage(err)}`)
    return 1
  }
}
